import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeCodeStatus } from '../../shared/agent-run'
import { isSendMessageRequest, isStartRunRequest } from '../ipc/claude.ipc'
import { CLAUDE_MESSAGES, ClaudeService, type ClaudeServiceDeps } from './claude.service'
import { WorktreeError } from './worktree.service'
import type { NotionTask } from '../../shared/notion'

const TASK: NotionTask = {
  id: 'task-1',
  url: 'https://www.notion.so/task1',
  displayId: 'ORK-7',
  title: 'Exportar CSV',
  status: { name: 'Em andamento', color: 'blue' },
  priority: { name: 'Alta', color: 'red' },
  assignees: ['Ana']
}
const READY: ClaudeCodeStatus = {
  installed: true,
  version: '2.1.5',
  loggedIn: true,
  authMethod: 'claude.ai',
  meetsMinimum: true,
  minimumVersion: '2.1.0',
  supportsEffort: true
}

function para(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] }, ...extra }
}

function setup(over: Partial<ClaudeServiceDeps> = {}) {
  const runs = {
    start: vi.fn(async () => ({ id: 'run-1' })),
    list: vi.fn(() => []),
    lastSession: vi.fn(() => null as string | null),
    isRunning: vi.fn(() => false),
    cancel: vi.fn(() => {
      throw new Error('not found')
    })
  }
  const worktrees = {
    get: vi.fn(() => null as null | { path: string; branch: string; baseRef: string }),
    ensure: vi.fn(async () => ({})),
    remove: vi.fn(async () => undefined),
    linkedBranches: vi.fn(() => [] as { branch: string }[])
  }
  const deps: ClaudeServiceDeps = {
    config: {
      update: vi.fn(async () => undefined),
      get: () =>
        ({
          projects: [
            {
              id: 'p1',
              name: 'app',
              localPath: '/repo',
              repo: { owner: 'o', name: 'app', remoteName: 'origin', defaultBranch: 'main' },
              notionProject: null
            }
          ],
          claudeContexts: {}
        }) as never
    },
    worktrees: worktrees as never,
    runs: runs as never,
    git: {
      statusPorcelain: vi.fn(async () => []),
      diffText: vi.fn(async () => 'diff --git a/x b/x'),
      diffShortstat: vi.fn(async () => ({ added: 3, removed: 1 })),
      localBranches: vi.fn(async () => ['main', 'ORK-7/exportar']),
      remoteBranches: vi.fn(async () => [])
    },
    listTasks: async () => ({
      ok: true,
      value: { tasks: [TASK] }
    }),
    signals: async () => ({ ok: false, error: { code: 'x', message: 'x' } }),
    getBlockChildren: vi.fn(async (id: string) => {
      if (id === 'task-1') {
        return {
          results: [
            {
              type: 'heading_2',
              heading_2: { rich_text: [{ plain_text: 'Critérios de aceite' }] }
            },
            para('Gera CSV', { id: 'b1', has_children: true })
          ],
          nextCursor: null
        }
      }
      return { results: [para('detalhe')], nextCursor: null }
    }),
    detect: vi.fn(async () => READY),
    openEditor: vi.fn(async () => undefined),
    openTerminal: vi.fn(async () => undefined),
    artifacts: {} as never,
    ...over
  }
  return { service: new ClaudeService(deps), deps, runs, worktrees }
}

describe('ClaudeService', () => {
  it('prepara o briefing com página, campos e a branch existente da tarefa', async () => {
    const { service } = setup()
    const r = await service.prepare('p1', 'task-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.branch).toBe('ORK-7/exportar')
    expect(r.value.briefing).toContain('# ORK-7 — Exportar CSV')
    expect(r.value.briefing).toContain('- **Prioridade:** Alta')
    expect(r.value.briefing).toContain('## Critérios de aceite\n\nGera CSV\n  detalhe')
    expect(r.value.workspace).toBeNull()
  })

  it('diff: devolve o texto, os arquivos novos e o que ainda está fora de commit', async () => {
    const { service, deps, worktrees } = setup()
    worktrees.get.mockReturnValue({ path: '/wt', branch: 'ORK-7/x', baseRef: 'origin/main' })
    ;(deps.git.statusPorcelain as ReturnType<typeof vi.fn>).mockResolvedValue([
      ' M src/a.ts',
      '?? docs/novo.md',
      '?? .orkio/',
      'R  velho.ts -> novo.ts'
    ])
    const r = await service.diff('p1', 'task-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.diff).toContain('diff --git')
    expect(r.value.truncated).toBe(false)
    expect(r.value.untracked).toEqual(['docs/novo.md', '.orkio/'])
    expect(r.value.uncommitted).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'docs/novo.md', status: 'untracked' },
      { path: 'novo.ts', status: 'renamed' }
    ]) // o que é interno do Orkio (.orkio/) não conta
    expect(r.value.secrets).toEqual([])
    expect(r.value.shortstat).toEqual({ added: 3, removed: 1 })
  })

  it('openTerminal: abre na pasta do worktree; sem terminal, erro em pt-BR', async () => {
    const { service, deps, worktrees } = setup()
    worktrees.get.mockReturnValue({ path: '/wt', branch: 'ORK-7/x', baseRef: 'origin/main' })
    expect(await service.openTerminal('p1', 'task-1')).toEqual({ ok: true, value: null })
    expect(deps.openTerminal).toHaveBeenCalledWith('/wt')
    ;(deps.openTerminal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'))
    expect(await service.openTerminal('p1', 'task-1')).toMatchObject({
      ok: false,
      error: { message: 'Não achei um terminal neste computador.' }
    })
    ;(deps.openTerminal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no_workspace')
    )
    expect(await service.openTerminal('p1', 'task-1')).toMatchObject({
      ok: false,
      error: { code: 'no_workspace' }
    })
    worktrees.get.mockReturnValue(null)
    expect(await service.openTerminal('p1', 'task-1')).toMatchObject({
      ok: false,
      error: { code: 'no_workspace' }
    })
  })

  it('diff: esconde o valor do segredo e diz em que arquivo ele está', async () => {
    const { service, deps, worktrees } = setup()
    worktrees.get.mockReturnValue({ path: '/wt', branch: 'ORK-7/x', baseRef: 'origin/main' })
    ;(deps.git.diffText as ReturnType<typeof vi.fn>).mockResolvedValue(
      [
        'diff --git a/docs/x.md b/docs/x.md',
        '--- /dev/null',
        '+++ b/docs/x.md',
        '@@ -0,0 +1,2 @@',
        '+# Doc',
        '+TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789'
      ].join('\n')
    )
    ;(deps.git.statusPorcelain as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const r = await service.diff('p1', 'task-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.diff).not.toContain('ghp_abcdef')
    expect(r.value.diff).toContain('TOKEN=[omitido]')
    expect(r.value.secrets).toEqual(['docs/x.md'])
  })

  it('página ilegível: briefing só com os campos, com aviso', async () => {
    const { service } = setup({
      getBlockChildren: async () => {
        throw new Error('403')
      }
    })
    const r = await service.prepare('p1', 'task-1')
    expect(r.ok && r.value.briefing).toContain(CLAUDE_MESSAGES.pageUnavailable)
  })

  it('página vazia no Notion: o fluxo (piloto automático) não começa', async () => {
    const { service } = setup({ getBlockChildren: async () => ({ results: [], nextCursor: null }) })
    const prep = await service.prepare('p1', 'task-1')
    expect(prep.ok && prep.value.descriptionEmpty).toBe(true)
    const ctx = await service.flowContext('p1', 'task-1')
    expect(ctx).toEqual({
      ok: false,
      error: { code: 'no_description', message: CLAUDE_MESSAGES.noDescription }
    })
  })

  it('página ilegível não conta como vazia (o fluxo segue só com os campos)', async () => {
    const { service } = setup({
      getBlockChildren: async () => {
        throw new Error('403')
      }
    })
    const prep = await service.prepare('p1', 'task-1')
    expect(prep.ok && prep.value.descriptionEmpty).toBe(false)
  })

  it('não roda sem Claude Code instalado/logado', async () => {
    const req = {
      projectId: 'p1',
      taskId: 'task-1',
      mode: 'prompt' as const,
      command: null,
      text: 'Faça',
      briefing: 'b'
    }
    const missing = setup({ detect: async () => ({ ...READY, installed: false }) })
    expect(await missing.service.start(req)).toMatchObject({
      ok: false,
      error: { code: 'not_installed' }
    })
    const logged = setup({ detect: async () => ({ ...READY, loggedIn: false }) })
    expect(await logged.service.start(req)).toMatchObject({
      ok: false,
      error: { code: 'not_logged_in' }
    })
    const ok = setup()
    expect((await ok.service.start(req)).ok).toBe(true)
    expect(ok.worktrees.ensure).toHaveBeenCalledWith(
      { id: 'p1', localPath: '/repo', remoteName: 'origin', defaultBranch: 'main' },
      { id: 'task-1', displayId: 'ORK-7', title: 'Exportar CSV' },
      {}
    )
    // Tipo da branch nova escolhido no formulário vai junto.
    await ok.service.start({ ...req, branchKind: 'hotfix' })
    expect(ok.worktrees.ensure).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      kind: 'hotfix'
    })
    expect(
      await ok.service.start({ ...req, mode: 'command', command: '../../x; rm' })
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })

  it('limpar ambiente com mudanças devolve a lista de arquivos', async () => {
    const { service, worktrees } = setup()
    worktrees.remove.mockRejectedValueOnce(new WorktreeError('dirty', 'Há mudanças', ['a.ts']))
    expect(await service.cleanup('p1', 'task-1', false)).toEqual({
      ok: false,
      error: { code: 'dirty', message: 'Há mudanças', files: ['a.ts'] }
    })
  })

  it('cancelar execução que já terminou não lança', () => {
    const { service } = setup()
    expect(() => service.cancel('run-x')).not.toThrow()
  })

  it('valida o payload de start vindo do renderer', () => {
    const base = {
      projectId: 'p1',
      taskId: 'task-1',
      mode: 'prompt',
      command: null,
      text: 'x',
      briefing: 'b'
    }
    expect(isStartRunRequest(base)).toBe(true)
    expect(isStartRunRequest({ ...base, projectId: '../x' })).toBe(false)
    expect(isStartRunRequest({ ...base, mode: 'shell' })).toBe(false)
    expect(isStartRunRequest({ ...base, briefing: 'x'.repeat(300_000) })).toBe(false)
  })

  it('briefing ignora o contexto do projeto salvo na config', async () => {
    const getBlockChildren = vi.fn(async () => ({ results: [], nextCursor: null }))
    const { service } = setup({
      config: {
        update: vi.fn(async () => undefined),
        get: () =>
          ({
            projects: [
              {
                id: 'p1',
                name: 'app',
                localPath: '/repo',
                repo: { owner: 'o', name: 'app', remoteName: 'origin', defaultBranch: 'main' },
                notionProject: null
              }
            ],
            claudeContexts: {
              p1: { instructions: 'NAO-DEVE-APARECER', notionPages: [{ id: 'x', name: 'X' }] }
            }
          }) as never
      },
      getBlockChildren
    })
    const r = await service.prepare('p1', 'task-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.briefing).not.toContain('NAO-DEVE-APARECER')
    expect(r.value.briefing).not.toContain('Contexto do projeto')
    expect(getBlockChildren).not.toHaveBeenCalledWith('x', expect.anything())
  })

  it('com fluxo ativo na tarefa, a execução manual é bloqueada (o fluxo roda os comandos)', async () => {
    const { service, runs } = setup({ flowActive: (taskId) => taskId === 'task-1' })
    const r = await service.start({
      projectId: 'p1',
      taskId: 'task-1',
      mode: 'prompt',
      command: null,
      text: 'Faça',
      briefing: 'b'
    })
    expect(r).toMatchObject({ ok: false, error: { code: 'flow_active' } })
    expect(runs.start).not.toHaveBeenCalled()
    // O passo do fluxo usa o mesmo caminho e devolve o id da execução.
    const fromFlow = await service.startForFlow({
      projectId: 'p1',
      taskId: 'task-1',
      command: 'revisar',
      args: 'ORK-7',
      briefing: 'b',
      timeoutMin: 5
    })
    expect(fromFlow).toEqual({ ok: true, value: 'run-1' })
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'command', command: 'revisar', text: 'ORK-7', timeoutMin: 5 })
    )
  })

  it('mensagem da sessão: continua a última sessão sem repetir o briefing', async () => {
    const { service, runs, deps } = setup()
    runs.lastSession.mockReturnValue('sess-9')
    const r = await service.send({ projectId: 'p1', taskId: 'task-1', text: '  Rode os testes  ' })
    expect(r.ok).toBe(true)
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'prompt',
        command: null,
        text: 'Rode os testes',
        briefing: '',
        resumeSessionId: 'sess-9'
      })
    )
    // Sem sessão nova, nada do Notion é lido.
    expect(deps.getBlockChildren).not.toHaveBeenCalled()
  })

  it('mensagem com runtime segue no --resume; sem suporte a effort, o effort é descartado', async () => {
    const { service, runs } = setup()
    runs.lastSession.mockReturnValue('sess-9')
    await service.send({
      projectId: 'p1',
      taskId: 'task-1',
      text: 'oi',
      runtime: { model: 'opus', effort: 'high' }
    })
    expect(runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resumeSessionId: 'sess-9',
        runtime: { model: 'opus', effort: 'high' }
      })
    )
    const old = setup({ detect: vi.fn(async () => ({ ...READY, supportsEffort: false })) })
    old.runs.lastSession.mockReturnValue('sess-9')
    await old.service.send({
      projectId: 'p1',
      taskId: 'task-1',
      text: 'oi',
      runtime: { model: 'opus', effort: 'high' }
    })
    expect(old.runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ runtime: { model: 'opus' } })
    )
    const agent = { key: 'a', name: 'A', prompt: 'p', model: null, effort: 'max' as const }
    await old.service.startForFlow({
      projectId: 'p1',
      taskId: 'task-1',
      command: 'revisar',
      args: '',
      briefing: '',
      timeoutMin: 5,
      agent,
      runtime: { effort: 'low' }
    })
    expect(old.runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: { ...agent, effort: null }, runtime: {} })
    )
  })

  it('startForFlow com reply: continua a sessão e leva o runtime do passo', async () => {
    const { service, runs } = setup()
    runs.lastSession.mockReturnValue('sess-3')
    const r = await service.startForFlow({
      projectId: 'p1',
      taskId: 'task-1',
      command: 'revisar',
      args: '',
      briefing: '',
      timeoutMin: 5,
      reply: 'x',
      runtime: { model: 'opus' }
    })
    expect(r.ok).toBe(true)
    expect(runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ resumeSessionId: 'sess-3', text: 'x', runtime: { model: 'opus' } })
    )
  })

  it('startForFlow com pedido em texto: continua a sessão (sem briefing) ou começa com ele; só leitura vai junto', async () => {
    const { service, runs } = setup()
    const input = {
      projectId: 'p1',
      taskId: 'task-1',
      command: '',
      args: '',
      briefing: '# Briefing ORK-7',
      timeoutMin: 5,
      prompt: 'Leia .orkio/revisao.md',
      readOnly: true
    }
    runs.lastSession.mockReturnValue('sess-4')
    expect((await service.startForFlow(input)).ok).toBe(true)
    expect(runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'prompt',
        command: null,
        text: 'Leia .orkio/revisao.md',
        briefing: '',
        resumeSessionId: 'sess-4',
        readOnly: true
      })
    )
    runs.lastSession.mockReturnValue(null)
    expect((await service.startForFlow({ ...input, readOnly: false })).ok).toBe(true)
    const call = runs.start.mock.calls.at(-1) as unknown as [Record<string, unknown>]
    expect(call[0]).toMatchObject({
      mode: 'prompt',
      briefing: '# Briefing ORK-7',
      includeBriefing: true,
      resumeSessionId: null
    })
    expect(call[0]['readOnly']).toBeUndefined()
  })

  it('mensagem da sessão: sem sessão (ou "nova sessão") começa com o briefing; /comando vira comando', async () => {
    const { service, runs } = setup()
    runs.lastSession.mockReturnValue('sess-9')
    await service.send({ projectId: 'p1', taskId: 'task-1', text: '/revisar ORK-7', fresh: true })
    const call = runs.start.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(call[0]).toMatchObject({
      mode: 'command',
      command: 'revisar',
      text: 'ORK-7',
      resumeSessionId: null
    })
    expect(String(call[0]['briefing'])).toContain('Exportar CSV')
    expect(
      await service.send({ projectId: 'p1', taskId: 'task-1', text: '/../x; rm' })
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(await service.send({ projectId: 'p1', taskId: 'task-1', text: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' }
    })
  })

  it('mensagem da sessão: fluxo rodando bloqueia; fluxo esperando você aceita', async () => {
    const busy = setup({ flowActive: () => true, flowBusy: () => true })
    expect(
      await busy.service.send({ projectId: 'p1', taskId: 'task-1', text: 'oi' })
    ).toMatchObject({ ok: false, error: { code: 'flow_running' } })
    expect(busy.runs.start).not.toHaveBeenCalled()
    const waiting = setup({ flowActive: () => true, flowBusy: () => false })
    expect((await waiting.service.send({ projectId: 'p1', taskId: 'task-1', text: 'oi' })).ok).toBe(
      true
    )
  })

  it('passo do fluxo com resposta: continua a sessão (--resume) só com o texto; sem sessão, explica', async () => {
    const { service, runs } = setup()
    runs.lastSession.mockReturnValue('sess-7')
    const flowInput = {
      projectId: 'p1',
      taskId: 'task-1',
      command: 'alva-flow:spec',
      args: 'ORK-7',
      briefing: 'b',
      timeoutMin: 5,
      reply: 'Formato: CSV'
    }
    expect(await service.startForFlow(flowInput)).toEqual({ ok: true, value: 'run-1' })
    expect(runs.start).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'prompt',
        command: null,
        text: 'Formato: CSV',
        briefing: '',
        resumeSessionId: 'sess-7',
        timeoutMin: 5
      })
    )
    runs.lastSession.mockReturnValue(null)
    expect(await service.startForFlow(flowInput)).toMatchObject({
      ok: false,
      error: { code: 'no_session' }
    })
  })

  describe('anexos da mensagem', () => {
    let wt = ''
    afterEach(async () => {
      if (wt) await rm(wt, { recursive: true, force: true })
      wt = ''
    })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
    const md = {
      name: 'nota.md',
      mime: 'text/markdown',
      data: new TextEncoder().encode('# segredo-xyz')
    }

    it('grava no worktree e o texto da execução termina com a nota (sem o conteúdo)', async () => {
      wt = await mkdtemp(join(tmpdir(), 'orkio-wt-'))
      const { service, runs, worktrees } = setup()
      worktrees.ensure.mockResolvedValue({ path: wt } as never)
      const r = await service.send({
        projectId: 'p1',
        taskId: 'task-1',
        text: 'veja',
        attachments: [md, { name: 'f.png', mime: 'image/png', data: png }]
      })
      expect(r.ok).toBe(true)
      const files = await readdir(join(wt, '.orkio', 'attachments'))
      expect(files).toHaveLength(2)
      const call = runs.start.mock.calls[0] as unknown as [{ text: string }]
      expect(call[0].text).toMatch(
        /^veja\n\nAnexos \(leia com a ferramenta Read\): \.orkio\/attachments\/[0-9a-f]{8}-nota\.md, \.orkio\/attachments\/[0-9a-f]{8}-f\.png$/
      )
      expect(JSON.stringify(call[0])).not.toContain('segredo-xyz')
      const saved = await readFile(
        join(
          wt,
          '.orkio',
          'attachments',
          files.find((f) => f.endsWith('.md'))!
        ),
        'utf8'
      )
      expect(saved).toBe('# segredo-xyz')
    })

    it('mensagem consumida pelo fluxo (interromper e continuar) leva os anexos junto', async () => {
      wt = await mkdtemp(join(tmpdir(), 'orkio-wt-'))
      const flowMessage = vi.fn(async () => ({ used: true }))
      const { service, runs, worktrees } = setup({ flowMessage, flowActive: () => true })
      worktrees.ensure.mockResolvedValue({ path: wt } as never)
      const r = await service.send({
        projectId: 'p1',
        taskId: 'task-1',
        text: 'mude o rumo',
        attachments: [md]
      })
      expect(r.ok).toBe(true)
      expect(runs.start).not.toHaveBeenCalled()
      expect(flowMessage).toHaveBeenCalledWith(
        'task-1',
        'mude o rumo',
        expect.stringMatching(
          /^\n\nAnexos \(leia com a ferramenta Read\): \.orkio\/attachments\/[0-9a-f]{8}-nota\.md$/
        )
      )
    })

    it('anexo inválido recusa a mensagem inteira, sem gravar nem rodar', async () => {
      const { service, runs, worktrees } = setup()
      const r = await service.send({
        projectId: 'p1',
        taskId: 'task-1',
        text: 'oi',
        attachments: [
          { name: 'x.png', mime: 'image/png', data: new TextEncoder().encode('<html>') }
        ]
      })
      expect(r).toMatchObject({
        ok: false,
        error: { message: 'O arquivo x.png não é uma imagem PNG.' }
      })
      expect(runs.start).not.toHaveBeenCalled()
      expect(worktrees.ensure).not.toHaveBeenCalled()
    })

    it('CLI ausente com anexo: recusa sem criar worktree nem gravar arquivo', async () => {
      wt = await mkdtemp(join(tmpdir(), 'orkio-wt-'))
      const { service, runs, worktrees } = setup({
        detect: vi.fn(async () => ({ ...READY, installed: false }))
      })
      worktrees.ensure.mockResolvedValue({ path: wt } as never)
      const r = await service.send({
        projectId: 'p1',
        taskId: 'task-1',
        text: 'oi',
        attachments: [md]
      })
      expect(r).toMatchObject({ ok: false, error: { code: 'not_installed' } })
      expect(worktrees.ensure).not.toHaveBeenCalled()
      expect(runs.start).not.toHaveBeenCalled()
      await expect(readdir(join(wt, '.orkio'))).rejects.toThrow()
    })

    it('recusa depois de gravar (execução recusada) apaga os anexos', async () => {
      wt = await mkdtemp(join(tmpdir(), 'orkio-wt-'))
      const { service, runs, worktrees } = setup()
      worktrees.ensure.mockResolvedValue({ path: wt } as never)
      runs.start.mockRejectedValueOnce(new Error('falhou'))
      const r = await service.send({
        projectId: 'p1',
        taskId: 'task-1',
        text: 'oi',
        attachments: [md]
      })
      expect(r.ok).toBe(false)
      expect(await readdir(join(wt, '.orkio', 'attachments'))).toEqual([])
    })

    it('fluxo ocupado (flow_running): recusa e não deixa anexos', async () => {
      wt = await mkdtemp(join(tmpdir(), 'orkio-wt-'))
      const { service, worktrees } = setup({
        flowActive: () => true,
        flowBusy: () => true,
        flowMessage: async () => ({ used: false })
      })
      worktrees.ensure.mockResolvedValue({ path: wt } as never)
      const r = await service.send({
        projectId: 'p1',
        taskId: 'task-1',
        text: 'oi',
        attachments: [md]
      })
      expect(r).toMatchObject({ ok: false, error: { code: 'flow_running' } })
      expect(await readdir(join(wt, '.orkio', 'attachments'))).toEqual([])
    })

    it('valida o payload dos anexos no IPC', () => {
      const base = { projectId: 'p1', taskId: 'task-1', text: 'x' }
      const ok = { name: 'a.md', mime: 'text/markdown', data: new Uint8Array(3) }
      expect(isSendMessageRequest({ ...base, attachments: [ok] })).toBe(true)
      expect(isSendMessageRequest({ ...base, attachments: Array(6).fill(ok) })).toBe(false)
      expect(
        isSendMessageRequest({ ...base, attachments: [{ ...ok, name: 'a'.repeat(121) }] })
      ).toBe(false)
      expect(isSendMessageRequest({ ...base, attachments: [{ ...ok, data: 'abc' }] })).toBe(false)
      expect(
        isSendMessageRequest({
          ...base,
          attachments: [{ ...ok, data: new Uint8Array(11 * 1024 * 1024) }]
        })
      ).toBe(false)
      expect(isSendMessageRequest({ ...base, attachments: [{ ...ok, path: '/etc/passwd' }] })).toBe(
        false
      )
    })
  })

  it('valida o payload da mensagem vinda do renderer', () => {
    const base = { projectId: 'p1', taskId: 'task-1', text: 'x' }
    expect(isSendMessageRequest(base)).toBe(true)
    expect(isSendMessageRequest({ ...base, fresh: true, asAgent: false })).toBe(true)
    expect(isSendMessageRequest({ ...base, taskId: '../x' })).toBe(false)
    expect(isSendMessageRequest({ ...base, fresh: 'sim' })).toBe(false)
    expect(isSendMessageRequest({ ...base, text: 'x'.repeat(300_000) })).toBe(false)
  })
})

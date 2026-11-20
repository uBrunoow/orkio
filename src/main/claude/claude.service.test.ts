import { describe, expect, it, vi } from 'vitest'
import type { ClaudeCodeStatus } from '../../shared/agent-run'
import type { NotionTask } from '../../shared/ipc-contract'
import { isStartRunRequest } from '../ipc/claude.ipc'
import { CLAUDE_MESSAGES, ClaudeService, type ClaudeServiceDeps } from './claude.service'
import { WorktreeError } from './worktree.service'

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
  minimumVersion: '2.1.0'
}

function para(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] }, ...extra }
}

function setup(over: Partial<ClaudeServiceDeps> = {}) {
  const runs = {
    start: vi.fn(async () => undefined),
    list: vi.fn(() => []),
    isRunning: vi.fn(() => false),
    cancel: vi.fn(() => {
      throw new Error('not found')
    })
  }
  const worktrees = {
    get: vi.fn(() => null as null | { path: string; branch: string; baseRef: string }),
    ensure: vi.fn(async () => ({})),
    remove: vi.fn(async () => undefined)
  }
  const deps: ClaudeServiceDeps = {
    searchPages: vi.fn(async () => ({ results: [], nextCursor: null })),
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

  it('página ilegível: briefing só com os campos, com aviso', async () => {
    const { service } = setup({
      getBlockChildren: async () => {
        throw new Error('403')
      }
    })
    const r = await service.prepare('p1', 'task-1')
    expect(r.ok && r.value.briefing).toContain(CLAUDE_MESSAGES.pageUnavailable)
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
      { id: 'task-1', displayId: 'ORK-7', title: 'Exportar CSV' }
    )
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

  it('contexto do projeto entra no briefing; página ilegível vira aviso; limites ao salvar', async () => {
    const ctx = {
      instructions: 'Rode pnpm test antes de commitar.',
      notionPages: [
        { id: 'ref-ok', name: 'Arquitetura' },
        { id: 'ref-404', name: 'Apagada' }
      ]
    }
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
            claudeContexts: { p1: ctx }
          }) as never
      },
      getBlockChildren: vi.fn(async (id: string) => {
        if (id === 'ref-404') throw new Error('404')
        if (id === 'ref-ok') return { results: [para('Use hexagonal.')], nextCursor: null }
        return { results: [], nextCursor: null }
      })
    })
    const r = await service.prepare('p1', 'task-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.briefing).toContain('## Contexto do projeto')
    expect(r.value.briefing).toContain('Rode pnpm test antes de commitar.')
    expect(r.value.briefing).toContain('### Arquitetura (Notion)\n\nUse hexagonal.')
    expect(r.value.contextWarnings).toEqual([
      'Não deu para ler a página “Apagada” no Notion; ela ficou de fora.'
    ])

    expect(
      await service.saveContext('p1', { instructions: 'x'.repeat(9000), notionPages: [] })
    ).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })
})

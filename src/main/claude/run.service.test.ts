import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunLogEvent } from '../../shared/agent-run'
import { BoardStore } from '../board/board.store'
import { openDatabase, type Db } from '../db/database'
import { askOrkio } from './bridge/client'
import { POLICY_MESSAGES } from './policy'
import { RUN_MESSAGES, RunService, type RunServiceDeps } from './run.service'
import type { PermissionBroker } from './runner'
import { WorktreeService } from './worktree.service'

interface FakeRun {
  opts: Parameters<RunServiceDeps['createRun']>[0]
  cancel: ReturnType<typeof vi.fn<() => void>>
  ask(tool: string, input: Record<string, unknown>, id?: string): Promise<Record<string, unknown>>
  emit(event: RunLogEvent): void
  exit(code?: number): void
}

describe('RunService', () => {
  let dir: string
  let db: Db
  let store: BoardStore
  let worktrees: WorktreeService
  let runs: FakeRun[]
  let messages: { runId: string; event: RunLogEvent }[]
  let notifications: string[]
  let service: RunService

  const project = {
    id: 'p1',
    name: 'app',
    localPath: '/repo',
    remoteName: 'origin',
    defaultBranch: 'main'
  }
  const task = (n: number) => ({ id: `task-${n}`, displayId: `ORK-${n}`, title: 'Tarefa' })

  function register(n: number): void {
    db.run(
      `INSERT INTO worktrees (task_page_id, project_id, path, branch, base_ref, created_at) VALUES (?, 'p1', ?, ?, 'origin/main', 'x')`,
      `task-${n}`,
      join(dir, 'wt', `ORK-${n}`),
      `ORK-${n}/tarefa`
    )
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-runs-'))
    db = openDatabase(':memory:')
    store = new BoardStore(db)
    worktrees = new WorktreeService({ git: {} as never, db, root: join(dir, 'wt') })
    runs = []
    messages = []
    notifications = []
    for (const n of [1, 2, 3]) register(n)
    service = new RunService({
      db,
      store,
      worktrees,
      git: {
        diffStat: vi.fn(async () => ({
          stat: ' src/a.ts | 2 +-',
          files: ['src/a.ts', '.orkio/briefing.md']
        })),
        commitsSince: vi.fn(async () => [{ hash: 'abc1234', subject: 'feat: lista' }])
      },
      createRun: (opts) => {
        const broker = opts.broker as PermissionBroker
        const run: FakeRun = {
          opts,
          cancel: vi.fn<() => void>(() => run.exit(130)),
          ask: (tool, input, id = `tu-${Math.random()}`) =>
            askOrkio(broker.socketPath, broker.token, { toolName: tool, input, toolUseId: id }),
          emit: (event) => opts.onEvent(event),
          exit: (code = 0) => opts.onExit({ code, signal: null, stderr: '' })
        }
        runs.push(run)
        return { start: async () => undefined, cancel: run.cancel }
      },
      runsDir: join(dir, 'runs'),
      emit: (m) => messages.push(m),
      notify: (title) => notifications.push(title),
      approvalTimeoutMs: 200,
      keepPerTask: 2,
      newId: (() => {
        let n = 0
        return () => `run-${++n}`
      })()
    })
  })

  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  const start = (n: number, over: Partial<Parameters<RunService['start']>[0]> = {}) =>
    service.start({
      project,
      task: task(n),
      mode: 'prompt',
      command: null,
      text: 'Implemente',
      briefing: '# ORK',
      ...over
    })
  const tick = () => new Promise((r) => setTimeout(r, 20))
  const statusOf = (id: string) => service.view(id)?.status

  it('prompt com briefing; comando instalado com argumentos', () => {
    expect(RunService.composePrompt('command', 'spec', 'foco em UX', '# B')).toBe(
      '/spec foco em UX\n\nBriefing da tarefa (também em .orkio/briefing.md no worktree):\n\n# B'
    )
    expect(RunService.composePrompt('prompt', null, 'Faça X', '# B')).toContain(
      'Faça X\n\n---\n\nBriefing'
    )
  })

  it('roda, registra log/histórico e resume arquivos, commits e testes', async () => {
    const view = await start(1)
    await tick()
    expect(statusOf(view.id)).toBe('running')
    const run = runs[0]!
    expect(run.opts.cwd).toBe(join(dir, 'wt', 'ORK-1'))
    run.emit({ kind: 'text', text: 'Trabalhando' })
    run.emit({ kind: 'tool', id: 't1', tool: 'Bash', summary: 'npm test -- --run' })
    run.emit({ kind: 'result', ok: true, durationMs: 1000, costUsd: 0.12, turns: 3, text: 'ok' })
    run.exit(0)
    await tick()
    const done = service.view(view.id)!
    expect(done).toMatchObject({ status: 'succeeded', costUsd: 0.12, branch: 'ORK-1/tarefa' })
    expect(done.summary).toEqual({
      files: ['src/a.ts'],
      diffStat: ' src/a.ts | 2 +-',
      commits: [{ hash: 'abc1234', subject: 'feat: lista' }],
      tests: ['npm test -- --run']
    })
    const log = await service.readLog(view.id)
    expect(log.map((e) => e.kind)).toEqual(['status', 'status', 'text', 'tool', 'result', 'status'])
    expect(store.events('task-1').map((e) => e.kind)).toEqual(['run_finished', 'run_started'])
  })

  it('agente (8A): instruções e modelo vão para o CLI; execução fica com o agente; política igual', async () => {
    const view = await start(1, {
      agent: { key: 'repo:ana', name: 'Ana', prompt: 'Você é Ana.', model: 'sonnet' }
    })
    await tick()
    const run = runs[0]!
    expect(run.opts.appendSystemPrompt).toBe('Você é Ana.')
    expect(run.opts.model).toBe('sonnet')
    expect(run.opts.delivery).toBe(false)
    expect(
      db.get<{ agent_key: string }>('SELECT agent_key FROM agent_runs WHERE id = ?', view.id)
    ).toEqual({ agent_key: 'repo:ana' })
    expect(store.events('task-1')[0]?.detail).toMatchObject({ agent: 'Ana', agentKey: 'repo:ana' })
    // Push continua bloqueado como em qualquer execução.
    const answer = await run.ask('Bash', { command: 'git push origin HEAD' })
    expect(answer['behavior']).toBe('deny')
    run.exit(0)
    await tick()
    const log = await service.readLog(view.id)
    expect(log.some((e) => e.kind === 'text' && e.text.startsWith('Rodando como Ana'))).toBe(true)
  })

  it('shell pede aprovação (notifica); "sempre neste projeto" vale para as próximas', async () => {
    await start(1)
    await tick()
    const run = runs[0]!
    const answer = run.ask('Bash', { command: 'npm test' }, 'req-1')
    await tick()
    expect(messages.at(-1)?.event).toMatchObject({
      kind: 'permission',
      state: 'pending',
      suggestion: 'npm test'
    })
    expect(notifications).toContain('O Claude Code pede aprovação')
    expect(service.waitingRequests()).toEqual([
      expect.objectContaining({ requestId: 'req-1', kind: 'permission', summary: 'npm test' })
    ])
    service.answerPermission('run-1', 'req-1', 'allow_always')
    expect(await answer).toEqual({ behavior: 'allow' })
    expect(await run.ask('Bash', { command: 'npm test -- --watch=false' })).toEqual({
      behavior: 'allow'
    })
    const denied = run.ask('Bash', { command: 'rm -rf build' }, 'req-3')
    await tick()
    service.answerPermission('run-1', 'req-3', 'deny')
    expect(await denied).toEqual({ behavior: 'deny', message: RUN_MESSAGES.denied })
  })

  it('push e fora do worktree são bloqueados sem perguntar, e vão para o histórico', async () => {
    await start(1)
    await tick()
    const run = runs[0]!
    expect(await run.ask('Bash', { command: 'git push origin HEAD' })).toEqual({
      behavior: 'deny',
      message: POLICY_MESSAGES.push
    })
    expect(await run.ask('Edit', { file_path: '/repo/src/a.ts' })).toEqual({
      behavior: 'deny',
      message: POLICY_MESSAGES.outside
    })
    expect(await run.ask('Edit', { file_path: join(dir, 'wt', 'ORK-1', 'src/a.ts') })).toEqual({
      behavior: 'allow'
    })
    expect(store.events('task-1').filter((e) => e.kind === 'run_blocked')).toHaveLength(2)
    expect(notifications).toEqual([])
  })

  it('modo entrega: só na execução marcada; 1ª vez pergunta, depois libera; histórico com link', async () => {
    const target = {
      owner: 'acme',
      repo: 'app',
      remote: 'origin',
      branch: 'ORK-1/tarefa',
      defaultBranch: 'main',
      displayId: 'ORK-1'
    }
    await start(1, { delivery: { target, requirePushApproval: false } })
    await tick()
    const run = runs[0]!
    expect(run.opts.delivery).toBe(true)
    // Primeira vez: pergunta, sem "sempre neste projeto".
    const first = run.ask('Bash', { command: 'gh pr create --fill' }, 'd-1')
    await tick()
    expect(messages.at(-1)?.event).toMatchObject({
      kind: 'permission',
      state: 'pending',
      delivery: true
    })
    expect(notifications).toContain('Entrega: o Claude Code pede aprovação')
    service.answerPermission('run-1', 'd-1', 'allow_always')
    expect(await first).toEqual({ behavior: 'allow' })
    expect(service.allowRules('p1')).toEqual([]) // nada salvo como "sempre"
    // Depois: liberado e marcado no log.
    expect(await run.ask('Bash', { command: 'gh pr comment 3 --body ok' })).toEqual({
      behavior: 'allow'
    })
    expect(messages.at(-1)?.event).toMatchObject({
      state: 'allowed',
      reason: 'Liberado pelo modo entrega'
    })
    // Bloqueios continuam, mesmo no modo entrega.
    expect(await run.ask('Bash', { command: 'gh pr merge 3 --squash' })).toMatchObject({
      behavior: 'deny'
    })
    expect(
      await run.ask('Bash', { command: 'git push --force origin ORK-1/tarefa' })
    ).toMatchObject({ behavior: 'deny' })
    const history = store.events('task-1').filter((e) => e.kind === 'delivery')
    expect(history.map((e) => e.detail?.['action']).sort()).toEqual(['pr_comment', 'pr_create'])
    expect(history[0]!.detail).toMatchObject({ by: 'claude', owner: 'acme', repo: 'app' })
    run.emit({ kind: 'result', ok: true, durationMs: 1, costUsd: 0, turns: 1, text: '' })
    run.exit(0)
    await tick()

    // Próximo passo (sem a marca): push e gh voltam a ser bloqueados.
    await start(1)
    await tick()
    const next = runs[1]!
    expect(next.opts.delivery).toBe(false)
    expect(await next.ask('Bash', { command: 'gh pr comment 3 --body ok' })).toEqual({
      behavior: 'deny',
      message: POLICY_MESSAGES.gh
    })
    expect(await next.ask('Bash', { command: 'git push origin ORK-1/tarefa' })).toEqual({
      behavior: 'deny',
      message: POLICY_MESSAGES.push
    })
  })

  it('token errado no socket é recusado', async () => {
    await start(1)
    await tick()
    const broker = runs[0]!.opts.broker as PermissionBroker
    expect(
      await askOrkio(broker.socketPath, 'errado', { toolName: 'Bash', input: { command: 'ls' } })
    ).toMatchObject({
      behavior: 'deny',
      message: 'Pedido não autorizado.'
    })
  })

  it('sem resposta no prazo: nega e registra', async () => {
    await start(1)
    await tick()
    expect(await runs[0]!.ask('Bash', { command: 'make' }, 'req-t')).toEqual({
      behavior: 'deny',
      message: RUN_MESSAGES.timeout
    })
  })

  it('pergunta do Claude: respostas voltam em updatedInput', async () => {
    await start(1)
    await tick()
    const input = {
      questions: [
        {
          question: 'Qual banco?',
          options: [{ label: 'Postgres' }, { label: 'SQLite' }],
          multiSelect: false
        }
      ]
    }
    const answer = runs[0]!.ask('AskUserQuestion', input, 'q-1')
    await tick()
    expect(messages.at(-1)?.event).toMatchObject({
      kind: 'question',
      state: 'pending',
      questions: [{ question: 'Qual banco?', options: ['Postgres', 'SQLite'], multiSelect: false }]
    })
    // Visão geral (6D): a pergunta aparece em "Esperando você" até ser respondida.
    expect(service.waitingRequests()).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        requestId: 'q-1',
        kind: 'question',
        summary: 'Qual banco?'
      })
    ])
    service.answerQuestion('run-1', 'q-1', { 'Qual banco?': 'SQLite' })
    expect(service.waitingRequests()).toEqual([])
    expect(await answer).toEqual({
      behavior: 'allow',
      updatedInput: { ...input, answers: { 'Qual banco?': 'SQLite' } }
    })
  })

  it('cancelar encerra, nega pendências e registra no histórico', async () => {
    const view = await start(1)
    await tick()
    const pending = runs[0]!.ask('Bash', { command: 'make' }, 'req-c')
    await tick()
    service.cancel(view.id)
    expect(runs[0]!.cancel).toHaveBeenCalled()
    expect(await pending).toEqual({ behavior: 'deny', message: RUN_MESSAGES.cancelled })
    await tick()
    expect(statusOf(view.id)).toBe('cancelled')
    expect(store.events('task-1')[0]?.kind).toBe('run_cancelled')
  })

  it('uma por tarefa; no máximo 2 em paralelo (a terceira espera na fila)', async () => {
    await start(1)
    await expect(start(1)).rejects.toThrow(RUN_MESSAGES.busy)
    await start(2)
    const third = await start(3)
    await tick()
    expect(runs).toHaveLength(2)
    expect(statusOf(third.id)).toBe('queued')
    expect(
      service
        .activeRuns()
        .map((r) => r.status)
        .sort()
    ).toEqual(['queued', 'running', 'running'])
    const first = runs.find((r) => r.opts.cwd.endsWith('ORK-1'))!
    first.emit({ kind: 'result', ok: true, durationMs: 1, costUsd: 0, turns: 1, text: '' })
    first.exit(0)
    await tick()
    expect(runs).toHaveLength(3)
    expect(statusOf(third.id)).toBe('running')
    // Cancelar na fila também registra.
    const queued = await start(1)
    service.cancel(queued.id)
    await tick()
    expect(statusOf(queued.id)).toBe('cancelled')
  })

  it('falha sem result → failed; mantém só os N logs mais recentes por tarefa', async () => {
    for (let i = 0; i < 3; i++) {
      await start(1)
      await tick()
      runs.at(-1)!.exit(1)
      await tick()
    }
    expect(service.list('task-1').map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
    // A limpeza dos logs é assíncrona: espera com prazo (não um intervalo fixo).
    await vi.waitFor(async () => expect((await readdir(join(dir, 'runs'))).length).toBe(2), {
      timeout: 3000
    })
  })

  it('valores de .env do worktree nunca vão para o log (nem repetidos pelo agente)', async () => {
    const wt = join(dir, 'wt', 'ORK-1')
    await mkdir(wt, { recursive: true })
    await writeFile(join(wt, '.env'), 'DB_URL="postgres://u:senha-forte-9@h/db"\nDEBUG=true\n')
    const view = await start(1)
    await tick()
    const run = runs[0]!
    run.emit({ kind: 'text', text: 'conectei em postgres://u:senha-forte-9@h/db com DEBUG=true' })
    // Arquivo .env criado depois: lido quando o agente o usa.
    await writeFile(join(wt, '.env.local'), 'SEGREDO_X=abc-123-xyz\n')
    run.emit({ kind: 'tool', id: 't', tool: 'Read', summary: '.env.local', file: '.env.local' })
    run.emit({ kind: 'text', text: 'o valor é abc-123-xyz e SENHA=qualquer' })
    run.exit(0)
    await tick()
    const raw = JSON.stringify(await service.readLog(view.id))
    expect(raw).not.toContain('senha-forte-9')
    expect(raw).not.toContain('abc-123-xyz')
    expect(raw).not.toContain('qualquer')
    expect(raw).toContain('DEBUG=true')
    expect(JSON.stringify(messages)).not.toContain('abc-123-xyz')
  })

  it('avisa quem pediu quando termina (texto redigido) e cancela no tempo limite como falha', async () => {
    const finished: { status: string; resultText: string; message: string | null }[] = []
    service.onFinished((f) => finished.push(f))
    await start(1)
    await tick()
    runs[0]!.emit({
      kind: 'result',
      ok: true,
      durationMs: 1,
      costUsd: 0,
      turns: 1,
      text: 'pronto @orkio pr=7 token ghp_abcdefghijklmnopqrstuvwxyz0123'
    })
    runs[0]!.exit(0)
    await tick()
    expect(finished[0]).toMatchObject({ status: 'succeeded', message: null })
    expect(finished[0]!.resultText).toContain('@orkio pr=7')
    expect(finished[0]!.resultText).not.toContain('ghp_abc')

    await start(2, { timeoutMin: 0.001 }) // ~60 ms
    await new Promise((r) => setTimeout(r, 150))
    expect(runs[1]!.cancel).toHaveBeenCalled()
    await tick()
    expect(finished[1]).toMatchObject({ status: 'failed', message: RUN_MESSAGES.timedOut })
  })
})

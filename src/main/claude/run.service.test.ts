import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunLogEvent } from '../../shared/agent-run'
import { BoardStore } from '../board/board.store'
import { openDatabase, type Db } from '../db/database'
import { askOrkio } from './bridge/client'
import { POLICY_MESSAGES } from './policy'
import { RUN_MESSAGES, RunBusyError, RunService, type RunServiceDeps } from './run.service'
import { deliveryOf, type RunSpec } from './run-spec'
import type { PermissionBroker } from './runner'
import { parseStreamLine } from './stream'
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
          files: ['src/a.ts', '.orkio/briefing.md', '.orkio/agents/ana.md']
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
      questionTimeoutMs: 1500,
      keepPerTask: 2,
      newId: (() => {
        let n = 0
        return () => `run-${++n}`
      })()
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    db.close()
    // Uma execução pode estar fechando o log (.jsonl) agora: tenta de novo se a pasta ainda não esvaziou.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  const start = (n: number, over: Partial<Omit<RunSpec, 'project' | 'task'>> = {}) =>
    service.start({
      project,
      task: task(n),
      input: { kind: 'prompt', text: 'Implemente' },
      session: { kind: 'new', briefing: '# ORK', includeBriefing: true },
      access: { tools: 'full', github: null },
      agent: null,
      runtime: { model: null, effort: null },
      timeoutMin: null,
      ...over
    })
  const resumeWith = (text: string, id: string): Partial<RunSpec> => ({
    input: { kind: 'prompt', text },
    session: { kind: 'resume', id }
  })
  const statusOf = (id: string) => service.view(id)?.status
  /** Espera o n-ésimo processo simulado existir (o status "running" vem antes dele). */
  const spawned = async (n: number) => {
    await vi.waitFor(() => expect(runs).toHaveLength(n), { timeout: 3000 })
    // Deixa o serviço terminar de registrar a execução antes do teste mexer nela.
    await new Promise((r) => setImmediate(r))
  }
  /** Espera a execução terminar (qualquer estado final), sem depender de um intervalo fixo. */
  const finished = (id: string) =>
    vi.waitFor(() => expect(['succeeded', 'failed', 'cancelled']).toContain(statusOf(id)), {
      timeout: 3000
    })

  it('prompt com briefing; comando instalado com argumentos; sessão retomada só o texto', () => {
    const fresh = { kind: 'new', briefing: '# B', includeBriefing: true } as const
    // O comando vem primeiro (o CLI só reconhece `/nome` no começo) e o briefing vai junto.
    const command = RunService.composePrompt(
      { kind: 'command', name: 'spec', args: 'foco em UX' },
      fresh
    )
    expect(command.startsWith('/spec foco em UX\n')).toBe(true)
    expect(command.endsWith('# B')).toBe(true)
    const prompt = RunService.composePrompt({ kind: 'prompt', text: 'Faça X' }, fresh)
    expect(prompt.startsWith('Faça X\n')).toBe(true)
    expect(prompt.endsWith('# B')).toBe(true)
    expect(
      RunService.composePrompt(
        { kind: 'command', name: 'alva-flow:plan', args: 'TASK-1' },
        { ...fresh, includeBriefing: false }
      )
    ).toBe('/alva-flow:plan TASK-1')
    expect(
      RunService.composePrompt({ kind: 'prompt', text: ' e agora? ' }, { kind: 'resume', id: 's' })
    ).toBe('e agora?')
  })

  it('roda, registra log/histórico e resume arquivos, commits e testes', async () => {
    const view = await start(1)
    await spawned(1)
    expect(statusOf(view.id)).toBe('running')
    const run = runs[0]!
    expect(run.opts.cwd).toBe(join(dir, 'wt', 'ORK-1'))
    run.emit({ kind: 'text', text: 'Trabalhando' })
    run.emit({ kind: 'tool', id: 't1', tool: 'Bash', summary: 'npm test -- --run' })
    run.emit({ kind: 'result', ok: true, durationMs: 1000, costUsd: 0.12, turns: 3, text: 'ok' })
    run.exit(0)
    await finished(view.id)
    const done = service.view(view.id)!
    expect(done).toMatchObject({ status: 'succeeded', costUsd: 0.12, branch: 'ORK-1/tarefa' })
    // O rascunho do Orkio sai do resumo; os perfis dos agentes (versionados) ficam.
    expect(done.summary).toEqual({
      files: ['src/a.ts', '.orkio/agents/ana.md'],
      diffStat: ' src/a.ts | 2 +-',
      commits: [{ hash: 'abc1234', subject: 'feat: lista' }],
      tests: ['npm test -- --run']
    })
    const log = await service.readLog(view.id)
    // O que o Claude mandou, na ordem, e o estado final por último (linhas de status/info no meio
    // não são contrato).
    expect(log.filter((e) => e.kind !== 'status' && e.kind !== 'info').map((e) => e.kind)).toEqual([
      'text',
      'tool',
      'result'
    ])
    expect(log.at(-1)).toMatchObject({ kind: 'status', status: 'succeeded' })
    expect(store.events('task-1').map((e) => e.kind)).toEqual(['run_finished', 'run_started'])
  })

  it('guarda a sessão; continuar usa --resume com o mesmo id e manda só o texto', async () => {
    const first = await start(1)
    await spawned(1)
    const sessionId = runs[0]!.opts.sessionId
    expect(runs[0]!.opts.spec.session.kind).toBe('new')
    expect(runs[0]!.opts.prompt).toContain('Briefing da tarefa')
    expect(service.view(first.id)?.hasSession).toBe(true)
    expect(service.lastSession('task-1')).toBe(sessionId)
    runs[0]!.exit(0)
    await finished(first.id)

    const second = await start(1, resumeWith('Agora rode os testes', sessionId))
    await spawned(2)
    expect(runs[1]!.opts).toMatchObject({ sessionId, prompt: 'Agora rode os testes' })
    expect(runs[1]!.opts.spec.session).toEqual({ kind: 'resume', id: sessionId })
    expect(store.events('task-1')[0]?.detail).toMatchObject({ resumed: true })
    runs[1]!.exit(0)
    await finished(second.id)
    expect(service.lastSession('task-1')).toBe(sessionId)
    expect(service.lastSession('task-2')).toBeNull()
  })

  it('custo: sessão nova guarda o total; --resume guarda só a diferença; total menor = reinício', async () => {
    const costOf = (id: string) =>
      db.get<{ cost: number; session_cost_total: number }>(
        'SELECT cost, session_cost_total FROM agent_runs WHERE id = ?',
        id
      )!
    const resultCosts = async (id: string) =>
      (await service.readLog(id)).flatMap((e) => (e.kind === 'result' ? [e.costUsd] : []))
    const result = (costUsd: number) =>
      ({ kind: 'result', ok: true, durationMs: 1, costUsd, turns: 1, text: '' }) as const

    const first = await start(1)
    await spawned(1)
    const sessionId = runs[0]!.opts.sessionId
    runs[0]!.emit(result(7.56))
    runs[0]!.exit(0)
    await finished(first.id)
    expect(costOf(first.id)).toEqual({ cost: 7.56, session_cost_total: 7.56 })
    expect(await resultCosts(first.id)).toEqual([7.56])

    const second = await start(1, resumeWith('mais', sessionId))
    await spawned(2)
    runs[1]!.emit(result(7.83))
    runs[1]!.exit(0)
    await finished(second.id)
    expect(costOf(second.id).cost).toBeCloseTo(0.27, 10)
    expect(costOf(second.id).session_cost_total).toBe(7.83)
    expect((await resultCosts(second.id))[0]).toBeCloseTo(0.27, 10)
    expect(service.view(second.id)?.costUsd).toBeCloseTo(0.27, 10)

    const third = await start(1, resumeWith('de novo', sessionId))
    await spawned(3)
    runs[2]!.emit(result(1.5))
    runs[2]!.exit(0)
    await finished(third.id)
    expect(costOf(third.id)).toEqual({ cost: 1.5, session_cost_total: 1.5 })
  })

  it('log "Modelo · Raciocínio" do runtime já resolvido; sem nada definido, sem linha', async () => {
    const view = await start(1, { runtime: { model: 'sonnet', effort: 'max' } })
    await spawned(1)
    expect(await service.readLog(view.id)).toContainEqual({
      kind: 'info',
      text: 'Modelo: Sonnet · Raciocínio: Máximo'
    })
    runs[0]!.exit(0)
    await finished(view.id)
    const second = await start(1)
    await spawned(2)
    expect((await service.readLog(second.id)).some((e) => e.kind === 'info')).toBe(false)
  })

  it('agente (8A): instruções e modelo vão para o CLI; execução fica com o agente; política igual', async () => {
    const view = await start(1, {
      agent: { key: 'repo:ana', name: 'Ana', prompt: 'Você é Ana.', model: 'sonnet', effort: null }
    })
    await spawned(1)
    const run = runs[0]!
    expect(run.opts.spec.agent?.prompt).toBe('Você é Ana.')
    expect(deliveryOf(run.opts.spec)).toBeNull()
    expect(
      db.get<{ agent_key: string }>('SELECT agent_key FROM agent_runs WHERE id = ?', view.id)
    ).toEqual({ agent_key: 'repo:ana' })
    expect(store.events('task-1')[0]?.detail).toMatchObject({ agent: 'Ana', agentKey: 'repo:ana' })
    // Push continua bloqueado como em qualquer execução.
    const answer = await run.ask('Bash', { command: 'git push origin HEAD' })
    expect(answer['behavior']).toBe('deny')
    run.exit(0)
    await finished(view.id)
    const log = await service.readLog(view.id)
    expect(log.some((e) => e.kind === 'text' && e.text.startsWith('Rodando como Ana'))).toBe(true)
  })

  it('shell pede aprovação (notifica); "sempre neste projeto" vale para as próximas', async () => {
    await start(1)
    await spawned(1)
    const run = runs[0]!
    const answer = run.ask('Bash', { command: 'npm test' }, 'req-1')
    await vi.waitFor(
      () => expect(messages.at(-1)?.event).toMatchObject({ kind: 'permission', state: 'pending' }),
      { timeout: 3000 }
    )
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
    await vi.waitFor(
      () => expect(service.waitingRequests().map((r) => r.requestId)).toContain('req-3'),
      { timeout: 3000 }
    )
    service.answerPermission('run-1', 'req-3', 'deny')
    expect(await denied).toEqual({ behavior: 'deny', message: RUN_MESSAGES.denied })
  })

  it('push e fora do worktree são bloqueados sem perguntar, e vão para o histórico', async () => {
    await start(1)
    await spawned(1)
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
    const view1 = await start(1, {
      access: { tools: 'full', github: { mode: 'deliver', target, requirePushApproval: false } }
    })
    await spawned(1)
    const run = runs[0]!
    expect(deliveryOf(run.opts.spec)).not.toBeNull()
    // Primeira vez: pergunta, sem "sempre neste projeto".
    const first = run.ask('Bash', { command: 'gh pr create --fill' }, 'd-1')
    await vi.waitFor(() => {
      expect(messages.at(-1)?.event).toMatchObject({
        kind: 'permission',
        state: 'pending',
        delivery: true
      })
      expect(notifications).toContain('Entrega: o Claude Code pede aprovação')
    })
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
    await finished(view1.id)

    // Próximo passo (sem a marca): push e gh voltam a ser bloqueados.
    await start(1)
    await spawned(2)
    const next = runs[1]!
    expect(deliveryOf(next.opts.spec)).toBeNull()
    expect(await next.ask('Bash', { command: 'gh pr comment 3 --body ok' })).toEqual({
      behavior: 'deny',
      message: POLICY_MESSAGES.gh
    })
    expect(await next.ask('Bash', { command: 'git push origin ORK-1/tarefa' })).toEqual({
      behavior: 'deny',
      message: POLICY_MESSAGES.push
    })
  })

  it('bug: push por alias (git p) no modo entrega lê a branch atual (antes: noBranch)', async () => {
    const target = {
      owner: 'acme',
      repo: 'app',
      remote: 'origin',
      branch: 'ORK-1/tarefa',
      defaultBranch: 'main',
      displayId: 'ORK-1'
    }
    const currentBranch = vi.fn(async () => 'ORK-1/tarefa')
    const svc = new RunService({
      ...(service as unknown as { deps: RunServiceDeps }).deps,
      newId: () => 'run-alias',
      policyInputs: async () => ({ aliases: { git: { p: 'push' } }, pushDefault: null }),
      currentBranch
    })
    await svc.start({
      project,
      task: task(2),
      input: { kind: 'prompt', text: 'Publique' },
      session: { kind: 'new', briefing: '# ORK', includeBriefing: true },
      access: { tools: 'full', github: { mode: 'deliver', target, requirePushApproval: false } },
      agent: null,
      runtime: { model: null, effort: null },
      timeoutMin: null
    })
    await spawned(1)
    const answer = runs[0]!.ask('Bash', { command: 'git p' }, 'push-1')
    await vi.waitFor(
      () =>
        expect(messages.at(-1)?.event).toMatchObject({
          kind: 'permission',
          state: 'pending',
          delivery: true
        }),
      { timeout: 3000 }
    )
    expect(currentBranch).toHaveBeenCalledTimes(1)
    svc.answerPermission('run-alias', 'push-1', 'allow_once')
    expect(await answer).toEqual({ behavior: 'allow' })
    // Comando sem push não lê a branch.
    await runs[0]!.ask('Bash', { command: 'gh pr view 1' })
    expect(currentBranch).toHaveBeenCalledTimes(1)
  })

  it('token errado no socket é recusado', async () => {
    await start(1)
    await spawned(1)
    const broker = runs[0]!.opts.broker as PermissionBroker
    expect(
      await askOrkio(broker.socketPath, 'errado', {
        toolName: 'Bash',
        input: { command: 'ls' },
        toolUseId: null
      })
    ).toMatchObject({
      behavior: 'deny',
      message: 'Pedido não autorizado.'
    })
  })

  it('sem resposta no prazo: nega e registra', async () => {
    await start(1)
    await spawned(1)
    expect(await runs[0]!.ask('Bash', { command: 'make' }, 'req-t')).toEqual({
      behavior: 'deny',
      message: RUN_MESSAGES.timeout
    })
  })

  it('pergunta do Claude espera bem mais que uma permissão: passa do prazo da permissão sem ser negada', async () => {
    await start(1)
    await spawned(1)
    const input = {
      questions: [{ question: 'Formato?', options: [{ label: 'CSV' }], multiSelect: false }]
    }
    // Relógio falso só para os prazos (o socket da ponte continua real).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const answer = runs[0]!.ask('AskUserQuestion', input, 'q-slow').then((a) => {
      settled = true
      return a
    })
    await vi.waitFor(
      () => expect(service.waitingRequests().map((r) => r.requestId)).toContain('q-slow'),
      { timeout: 3000 }
    )
    await vi.advanceTimersByTimeAsync(500) // 2,5× o prazo da permissão (200 ms)
    vi.useRealTimers()
    expect(settled).toBe(false)
    expect(service.waitingRequests()).toEqual([
      expect.objectContaining({ requestId: 'q-slow', kind: 'question' })
    ])
    service.answerQuestion('run-1', 'q-slow', { 'Formato?': 'CSV' })
    expect(await answer).toMatchObject({ behavior: 'allow' })
  })

  it('pergunta sem resposta no prazo longo também é negada', async () => {
    await start(1)
    await spawned(1)
    const input = {
      questions: [{ question: 'Formato?', options: [{ label: 'CSV' }], multiSelect: false }]
    }
    expect(await runs[0]!.ask('AskUserQuestion', input, 'q-late')).toEqual({
      behavior: 'deny',
      message: RUN_MESSAGES.timeout
    })
  })

  it('pergunta do Claude: respostas voltam em updatedInput', async () => {
    await start(1)
    await spawned(1)
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
    await vi.waitFor(
      () => expect(messages.at(-1)?.event).toMatchObject({ kind: 'question', state: 'pending' }),
      { timeout: 3000 }
    )
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
    await spawned(1)
    const pending = runs[0]!.ask('Bash', { command: 'make' }, 'req-c')
    await vi.waitFor(
      () => expect(messages.at(-1)?.event).toMatchObject({ kind: 'permission', state: 'pending' }),
      { timeout: 3000 }
    )
    service.cancel(view.id)
    expect(runs[0]!.cancel).toHaveBeenCalled()
    expect(await pending).toEqual({ behavior: 'deny', message: RUN_MESSAGES.cancelled })
    await finished(view.id)
    expect(statusOf(view.id)).toBe('cancelled')
    expect(store.events('task-1')[0]?.kind).toBe('run_cancelled')
  })

  it('uma por tarefa; no máximo 2 em paralelo (a terceira espera na fila)', async () => {
    await start(1)
    await expect(start(1)).rejects.toBeInstanceOf(RunBusyError)
    await start(2)
    const third = await start(3)
    await spawned(2)
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
    // Prazo, não intervalo fixo: no CI a fila pode levar mais que alguns ms para andar.
    await spawned(3)
    await vi.waitFor(() => expect(statusOf(third.id)).toBe('running'), { timeout: 3000 })
    // Cancelar na fila também registra.
    const queued = await start(1)
    service.cancel(queued.id)
    await vi.waitFor(() => expect(statusOf(queued.id)).toBe('cancelled'), { timeout: 3000 })
  })

  it('falha sem result → failed; mantém só os N logs mais recentes por tarefa', async () => {
    for (let i = 0; i < 3; i++) {
      const view = await start(1)
      await spawned(i + 1)
      runs.at(-1)!.exit(1)
      await finished(view.id)
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
    await spawned(1)
    const run = runs[0]!
    run.emit({ kind: 'text', text: 'conectei em postgres://u:senha-forte-9@h/db com DEBUG=true' })
    // Arquivo .env criado depois, numa subpasta: lido quando o agente o lê com `Read` (o evento
    // vem do parser real do stream-json; antes ele só trazia `file` nas edições).
    await mkdir(join(wt, 'apps', 'api'), { recursive: true })
    await writeFile(join(wt, 'apps', 'api', '.env.local'), 'SEGREDO_X=abc-123-xyz\n')
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'Read',
            input: { file_path: join(wt, 'apps', 'api', '.env.local') }
          }
        ]
      }
    })
    for (const event of parseStreamLine(line, wt)) run.emit(event)
    run.emit({ kind: 'text', text: 'o valor é abc-123-xyz e SENHA=qualquer' })
    run.exit(0)
    await finished(view.id)
    const raw = JSON.stringify(await service.readLog(view.id))
    expect(raw).not.toContain('senha-forte-9')
    expect(raw).not.toContain('abc-123-xyz')
    expect(raw).not.toContain('qualquer')
    expect(raw).toContain('DEBUG=true')
    expect(JSON.stringify(messages)).not.toContain('abc-123-xyz')
  })

  it('bug: só leitura — "sempre neste projeto" não libera nada; todo comando pergunta', async () => {
    db.run(
      `INSERT INTO permission_rules (project_id, tool, pattern, created_at) VALUES ('p1', 'Bash', 'npm test', 'x')`
    )
    await start(1)
    await spawned(1)
    expect(await runs[0]!.ask('Bash', { command: 'npm test' })).toEqual({ behavior: 'allow' })
    runs[0]!.exit(0)
    await vi.waitFor(() => expect(service.activeRuns()).toEqual([]), { timeout: 3000 })

    const ro = await start(1, { access: { tools: 'read_only', github: null } })
    await spawned(2)
    expect(await service.readLog(ro.id)).toContainEqual(
      expect.objectContaining({ kind: 'info', text: expect.stringContaining('todo comando pede') })
    )
    const answer = runs[1]!.ask('Bash', { command: 'npm test' }, 'ro-1')
    await vi.waitFor(
      () => expect(messages.at(-1)?.event).toMatchObject({ kind: 'permission', state: 'pending' }),
      { timeout: 3000 }
    )
    service.answerPermission(ro.id, 'ro-1', 'deny')
    expect(await answer).toEqual({ behavior: 'deny', message: RUN_MESSAGES.denied })
    // Editar no passo só de leitura é bloqueado, com o código no log.
    expect(await runs[1]!.ask('Edit', { file_path: join(dir, 'wt', 'ORK-1', 'src/a.ts') })).toEqual(
      { behavior: 'deny', message: POLICY_MESSAGES.readOnly }
    )
    expect(messages.at(-1)?.event).toMatchObject({ state: 'blocked', code: 'read_only' })
  })

  it('avisa quem pediu quando termina (texto redigido) e cancela no tempo limite como falha', async () => {
    const finished: { status: string; resultText: string; message: string | null }[] = []
    service.onFinished((f) => finished.push(f))
    await start(1)
    await spawned(1)
    runs[0]!.emit({
      kind: 'result',
      ok: true,
      durationMs: 1,
      costUsd: 0,
      turns: 1,
      text: 'pronto @orkio pr=7 token ghp_abcdefghijklmnopqrstuvwxyz0123'
    })
    runs[0]!.exit(0)
    await vi.waitFor(() => expect(finished).toHaveLength(1), { timeout: 3000 })
    expect(finished[0]).toMatchObject({ status: 'succeeded', message: null })
    expect(finished[0]!.resultText).toContain('@orkio pr=7')
    expect(finished[0]!.resultText).not.toContain('ghp_abc')

    await start(2, { timeoutMin: 0.001 }) // ~60 ms
    await spawned(2)
    await vi.waitFor(() => expect(runs[1]!.cancel).toHaveBeenCalled(), { timeout: 3000 })
    await vi.waitFor(() => expect(finished).toHaveLength(2), { timeout: 3000 })
    expect(finished[1]).toMatchObject({ status: 'failed', message: RUN_MESSAGES.timedOut })
  })

  it('consultas dos outros módulos: início/comando, custo da semana, uso do agente, contagens', () => {
    const add = (
      id: string,
      status: string,
      startedAt: string,
      cost: number | null,
      agent: string | null
    ): void => {
      db.run(
        `INSERT INTO agent_runs (id, task_page_id, project_id, mode, command, status, started_at, cost, agent_key)
         VALUES (?, 'task-1', 'p1', 'command', 'revisar', ?, ?, ?, ?)`,
        id,
        status,
        startedAt,
        cost,
        agent
      )
    }
    add('a', 'succeeded', '2026-11-19T00:00:00.000Z', 0.4, 'repo:ana')
    add('b', 'failed', '2026-11-19T01:00:00.000Z', null, 'repo:ana')
    add('c', 'running', '2026-11-19T02:00:00.000Z', null, null)
    add('d', 'succeeded', '2026-11-01T00:00:00.000Z', 9, 'repo:ana')
    expect(service.startInfo(['c', 'x'])).toEqual(
      new Map([['c', { startedAt: '2026-11-19T02:00:00.000Z', command: 'revisar' }]])
    )
    expect(service.costsSince('2026-11-13T00:00:00.000Z')).toEqual([0.4, null])
    expect(service.agentRunsSince('repo:ana', '2026-11-13T00:00:00.000Z')).toEqual({
      count: 2,
      costUsd: 0.4,
      startedAt: ['2026-11-19T00:00:00.000Z', '2026-11-19T01:00:00.000Z']
    })
    expect(service.counts()).toEqual({ total: 4, active: 1 })
  })
})

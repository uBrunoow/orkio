/**
 * Execuções do Claude Code por tarefa (Etapa 4A): worktree → briefing → `claude -p` → log ao vivo
 * → resumo (diff/commits/testes) → histórico. Push/PR só no "modo entrega" de um passo de fluxo
 * (5C), com as regras de `delivery-policy.ts` e aprovação na primeira vez em cada execução.
 *
 * - Uma execução por tarefa; até `maxParallel` em paralelo (fila FIFO além disso).
 * - Permissões: política pura (`policy.ts`) + pergunta ao usuário (10 min sem resposta → negar).
 * - Log: eventos normalizados em `<runsDir>/<id>.jsonl` (sem conteúdo de arquivos; segredos
 *   redigidos), mantendo os `keepPerTask` mais recentes por tarefa.
 * - Nada do conteúdo da página vai para o SQLite: só ids, status, datas, custo e resumo técnico.
 */
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  AgentRunView,
  PermissionAnswer,
  RunLogEvent,
  RunMode,
  RunStatus,
  RunSummary
} from '../../shared/agent-run'
import type { BoardStore } from '../board/board.store'
import type { Db } from '../db/database'
import type { Git } from '../git/git'
import type { DeliveryTarget } from '../../shared/delivery'
import type { DeliveryEvent, DeliveryKind } from './delivery-policy'
import {
  DELIVERY_ALLOWED,
  evaluatePermission,
  isInside,
  type AllowRule,
  type DeliveryAction,
  type PolicyAliases
} from './policy'
import { envFileValues, isEnvFile, redactSecrets, redactValues } from './redact'
import { PermissionBroker, type BridgeDecision, type BridgeRequest } from './runner'
import type {
  WorktreeProject,
  WorktreeRecord,
  WorktreeService,
  WorktreeTask
} from './worktree.service'

export interface RunHandle {
  start(): Promise<void>
  cancel(): void
}

export interface RunServiceDeps {
  db: Db
  store: BoardStore
  worktrees: WorktreeService
  git: Pick<Git, 'diffStat' | 'commitsSince'>
  /** Cria o processo do Claude Code (real: ClaudeRun; testes: falso). */
  createRun(options: {
    cwd: string
    prompt: string
    sessionId: string
    broker: PermissionBroker
    /** Modo entrega (5C): troca as regras `deny` do CLI pelas do modo entrega. */
    delivery: boolean
    onEvent(event: RunLogEvent): void
    onExit(result: { code: number | null; signal: NodeJS.Signals | null; stderr: string }): void
  }): RunHandle
  /** Aliases do git/gh e `push.default`, lidos no começo da execução (política). */
  policyInputs?(dir: string): Promise<{ aliases: PolicyAliases; pushDefault: string | null }>
  /** Branch atual do worktree, lida antes de avaliar um push. */
  currentBranch?(dir: string): Promise<string | null>
  /** Número da PR aberta da branch (sinais da 2D), para o link no histórico. */
  prFor?(projectId: string, branch: string): number | null
  runsDir: string
  emit(message: { runId: string; projectId: string; taskId: string; event: RunLogEvent }): void
  /** Notificação de desktop (pedido de aprovação/pergunta). */
  notify(title: string, body: string, ref: { projectId: string; taskId: string }): void
  maxParallel?: number
  keepPerTask?: number
  approvalTimeoutMs?: number
  now?: () => Date
  newId?: () => string
}

export interface StartRunInput {
  project: WorktreeProject & { name: string }
  task: WorktreeTask
  mode: RunMode
  /** Comando instalado (sem a barra), quando mode = 'command'. */
  command: string | null
  /** Texto livre (prompt) ou argumentos do comando. */
  text: string
  briefing: string
  /** Tempo limite (min): ao estourar, cancela e a execução termina como falha. */
  timeoutMin?: number
  /** Comando: junta o briefing ao texto (padrão). Falso = só os argumentos; o arquivo continua. */
  includeBriefing?: boolean
  /** Modo entrega (5C): só em passo de fluxo marcado; vale só nesta execução. */
  delivery?: { target: DeliveryTarget; requirePushApproval: boolean } | null
}

/** Fim de uma execução, para quem a pediu (5A: fluxos). */
export interface RunFinished {
  runId: string
  taskId: string
  status: RunStatus
  /** Texto final do Claude (já redigido), se houve `result`. */
  resultText: string
  summary: RunSummary | null
  costUsd: number | null
  /** Motivo curto quando não foi sucesso (ex.: tempo esgotado). */
  message: string | null
}

interface Pending {
  resolve(decision: BridgeDecision): void
  timer: NodeJS.Timeout
  /** Quando o pedido chegou e se é pergunta (AskUserQuestion) ou permissão (Visão geral, 6D). */
  since: string
  kind: 'question' | 'permission'
  tool: string
  summary: string
  input: Record<string, unknown>
  suggestion: string | null
  /** Comandos de entrega neste pedido (aprovar libera a categoria nesta execução). */
  delivery: DeliveryAction[] | null
}

interface ActiveRun {
  id: string
  projectId: string
  taskId: string
  handle: RunHandle | null
  worktree: WorktreeRecord
  status: RunStatus
  cancelled: boolean
  pending: Map<string, Pending>
  tests: Set<string>
  costUsd: number | null
  ok: boolean | null
  resultText: string
  timer: NodeJS.Timeout | null
  timedOut: boolean
  /** Valores lidos de arquivos .env do worktree: escondidos em tudo que vai para o log. */
  secrets: Set<string>
  /** Modo entrega (5C) e categorias já aprovadas nesta execução. */
  delivery: StartRunInput['delivery'] | null
  granted: Set<DeliveryKind>
  aliases: PolicyAliases
  pushDefault: string | null
  start: () => Promise<void>
}

export const RUN_MESSAGES = {
  busy: 'Esta tarefa já tem uma execução em andamento. Espere terminar ou cancele.',
  timeout: 'Sem resposta em 10 minutos: o Orkio negou o pedido.',
  denied: 'Negado por você no Orkio.',
  cancelled: 'Execução cancelada.',
  notFound: 'Execução não encontrada.',
  timedOut: 'Tempo limite esgotado: o Orkio cancelou a execução.'
} as const

const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|e2e|vitest|jest)\b|\b(vitest|jest|pytest|go test|cargo test|playwright test)\b/

/** Primeira pergunta do AskUserQuestion (e quantas há), para listas curtas. */
function questionSummary(input: Record<string, unknown>): string {
  const questions = Array.isArray(input['questions']) ? (input['questions'] as unknown[]) : []
  const first = questions[0] as Record<string, unknown> | undefined
  const text = typeof first?.['question'] === 'string' ? first['question'].slice(0, 200) : ''
  if (questions.length > 1) return `${questions.length} perguntas${text ? `: ${text}` : ''}`
  return text || 'Pergunta do Claude Code'
}

export class RunService {
  private readonly active = new Map<string, ActiveRun>()
  private readonly queue: ActiveRun[] = []
  private readonly maxParallel: number
  private readonly keepPerTask: number
  private readonly logWrites = new Map<string, Promise<void>>()
  private readonly finishListeners = new Set<(info: RunFinished) => void>()
  private readonly approvalTimeoutMs: number

  constructor(private readonly deps: RunServiceDeps) {
    this.maxParallel = deps.maxParallel ?? 2
    this.keepPerTask = deps.keepPerTask ?? 10
    this.approvalTimeoutMs = deps.approvalTimeoutMs ?? 10 * 60_000
    // Execuções que ficaram "em andamento" (app fechado/derrubado): o processo não existe mais.
    deps.db.run(
      `UPDATE agent_runs SET status = 'failed', ended_at = ? WHERE status IN ('queued', 'running')`,
      this.now().toISOString()
    )
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** Comando final enviado ao Claude: comando instalado + argumentos, e o briefing junto. */
  static composePrompt(
    mode: RunMode,
    command: string | null,
    text: string,
    briefing: string,
    includeBriefing = true
  ): string {
    const brief = `Briefing da tarefa (também em .orkio/briefing.md no worktree):\n\n${briefing}`
    if (mode === 'command' && command) {
      const line = `/${command}${text.trim() ? ` ${text.trim()}` : ''}`
      // Sem o briefing: o comando recebe só os argumentos ($ARGUMENTS), ex.: um task-ID.
      return includeBriefing ? `${line}\n\n${brief}` : line
    }
    return `${text.trim()}\n\n---\n\n${brief}`
  }

  /** Execuções rodando ou na fila (6C: a atualização não reinicia por cima delas). */
  activeList(): { projectId: string; taskId: string; queued: boolean }[] {
    return [
      ...[...this.active.values()].map((r) => ({
        projectId: r.projectId,
        taskId: r.taskId,
        queued: false
      })),
      ...this.queue.map((r) => ({ projectId: r.projectId, taskId: r.taskId, queued: true }))
    ]
  }

  /** Pedidos esperando você (perguntas e permissões), em memória; para a Visão geral (6D). */
  waitingRequests(): {
    runId: string
    projectId: string
    taskId: string
    requestId: string
    kind: 'question' | 'permission'
    summary: string
    since: string
  }[] {
    return [...this.active.values()].flatMap((run) =>
      [...run.pending].map(([requestId, p]) => ({
        runId: run.id,
        projectId: run.projectId,
        taskId: run.taskId,
        requestId,
        kind: p.kind,
        summary: scrubText(
          p.kind === 'question' ? questionSummary(p.input) : p.summary,
          run.secrets
        ),
        since: p.since
      }))
    )
  }

  /** Execuções na fila ou rodando (em memória); para a Visão geral (6D). */
  activeRuns(): { runId: string; projectId: string; taskId: string; status: RunStatus }[] {
    return [...this.active.values(), ...this.queue].map((r) => ({
      runId: r.id,
      projectId: r.projectId,
      taskId: r.taskId,
      status: r.status
    }))
  }

  isRunning(taskId: string): boolean {
    return [...this.active.values(), ...this.queue].some((r) => r.taskId === taskId)
  }

  /** Inicia (ou enfileira) uma execução. O worktree precisa ter sido preparado antes. */
  async start(input: StartRunInput): Promise<AgentRunView> {
    if (this.isRunning(input.task.id)) throw new Error(RUN_MESSAGES.busy)
    const worktree = this.deps.worktrees.get(input.task.id)
    if (!worktree) throw new Error('Prepare o ambiente da tarefa antes de rodar.')
    const id = this.deps.newId?.() ?? randomUUID()
    const startedAt = this.now().toISOString()
    this.deps.db.run(
      `INSERT INTO agent_runs (id, task_page_id, project_id, mode, command, status, started_at, input_text)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      id,
      input.task.id,
      input.project.id,
      input.mode,
      input.command,
      startedAt,
      redactSecrets(input.text).slice(0, 20_000)
    )
    await mkdir(this.deps.runsDir, { recursive: true })

    const run: ActiveRun = {
      id,
      projectId: input.project.id,
      taskId: input.task.id,
      handle: null,
      worktree,
      status: 'queued',
      cancelled: false,
      pending: new Map(),
      tests: new Set(),
      costUsd: null,
      ok: null,
      resultText: '',
      timer: null,
      timedOut: false,
      secrets: new Set(),
      delivery: input.delivery ?? null,
      granted: new Set(),
      aliases: {},
      pushDefault: null,
      start: async () => {
        run.status = 'running'
        this.setStatus(run, 'running')
        this.taskEvent(run, 'run_started', { mode: input.mode, command: input.command })
        // Briefing também em arquivo (fora do git: .git/info/exclude do worktree).
        await this.writeBriefing(worktree.path, input.briefing).catch(() => undefined)
        this.collectEnvSecrets(run, worktree.path)
        const inputs = await this.deps.policyInputs?.(worktree.path).catch(() => null)
        if (inputs) {
          run.aliases = inputs.aliases
          run.pushDefault = inputs.pushDefault
        }
        if (run.delivery) {
          const t = run.delivery.target
          this.log(run, {
            kind: 'text',
            text: `Modo entrega ligado neste passo: push só de ${t.branch} (${t.remote}) e GitHub CLI só em ${t.owner}/${t.repo}.`
          })
        }
        const broker = new PermissionBroker((req) => this.onPermission(run, req))
        await broker.open()
        run.handle = this.deps.createRun({
          cwd: worktree.path,
          prompt: RunService.composePrompt(
            input.mode,
            input.command,
            input.text,
            input.briefing,
            input.includeBriefing !== false
          ),
          sessionId: randomUUID(),
          broker,
          delivery: !!run.delivery,
          onEvent: (event) => this.onEvent(run, event),
          onExit: (result) => void this.onExit(run, result)
        })
        await run.handle.start()
        if (input.timeoutMin && input.timeoutMin > 0) {
          run.timer = setTimeout(() => {
            run.timedOut = true
            run.cancelled = true
            for (const [requestId, p] of run.pending) {
              this.resolvePending(run, requestId, p, {
                behavior: 'deny',
                message: RUN_MESSAGES.timedOut
              })
            }
            run.handle?.cancel()
          }, input.timeoutMin * 60_000)
        }
      }
    }
    this.queue.push(run)
    this.log(run, { kind: 'status', status: 'queued' })
    this.pump()
    return this.view(id)!
  }

  /** Ao fechar o app: cancela tudo (o processo do Claude Code não sobrevive ao Orkio). */
  cancelAll(): void {
    for (const id of [...this.queue.map((r) => r.id), ...this.active.keys()]) {
      try {
        this.cancel(id)
      } catch {
        // já terminou
      }
    }
  }

  cancel(runId: string): void {
    const queued = this.queue.findIndex((r) => r.id === runId)
    if (queued >= 0) {
      const [run] = this.queue.splice(queued, 1)
      run!.cancelled = true
      void this.finish(run!, 'cancelled', RUN_MESSAGES.cancelled)
      return
    }
    const run = this.active.get(runId)
    if (!run) throw new Error(RUN_MESSAGES.notFound)
    run.cancelled = true
    for (const [requestId, p] of run.pending)
      this.resolvePending(run, requestId, p, { behavior: 'deny', message: RUN_MESSAGES.cancelled })
    run.handle?.cancel()
  }

  /** Resposta do usuário a um pedido de permissão. */
  answerPermission(runId: string, requestId: string, answer: PermissionAnswer): void {
    const run = this.active.get(runId)
    const p = run?.pending.get(requestId)
    if (!run || !p) throw new Error(RUN_MESSAGES.notFound)
    if (answer === 'allow_always' && p.suggestion && !p.delivery) {
      this.deps.db.run(
        `INSERT OR IGNORE INTO permission_rules (project_id, tool, pattern, created_at) VALUES (?, ?, ?, ?)`,
        run.projectId,
        p.tool,
        p.suggestion,
        this.now().toISOString()
      )
    }
    const decision: BridgeDecision =
      answer === 'deny' ? { behavior: 'deny', message: RUN_MESSAGES.denied } : { behavior: 'allow' }
    if (answer !== 'deny' && p.delivery) {
      for (const a of p.delivery) run.granted.add(a.kind)
      this.deliveryEvents(run, p.delivery, p.summary)
    }
    this.log(run, {
      kind: 'permission',
      requestId,
      tool: p.tool,
      summary: p.summary,
      state: answer === 'deny' ? 'denied' : 'allowed',
      ...(answer !== 'deny' && p.delivery
        ? { reason: `${DELIVERY_ALLOWED} (aprovado por você)` }
        : answer === 'allow_always' && p.suggestion
          ? { reason: `sempre neste projeto: ${p.suggestion}` }
          : {})
    })
    this.resolvePending(run, requestId, p, decision)
  }

  /** Respostas às perguntas do Claude (AskUserQuestion): pergunta → opção(ões) escolhida(s). */
  answerQuestion(runId: string, requestId: string, answers: Record<string, string>): void {
    const run = this.active.get(runId)
    const p = run?.pending.get(requestId)
    if (!run || !p) throw new Error(RUN_MESSAGES.notFound)
    this.log(run, { kind: 'question', requestId, questions: [], state: 'answered' })
    this.resolvePending(run, requestId, p, {
      behavior: 'allow',
      updatedInput: { ...p.input, answers }
    })
  }

  allowRules(projectId: string): AllowRule[] {
    return this.deps.db.all<AllowRule>(
      'SELECT tool, pattern FROM permission_rules WHERE project_id = ?',
      projectId
    )
  }

  list(taskId: string): AgentRunView[] {
    return this.deps.db
      .all<{ id: string }>(
        'SELECT id FROM agent_runs WHERE task_page_id = ? ORDER BY started_at DESC',
        taskId
      )
      .map((r) => this.view(r.id)!)
  }

  async readLog(runId: string): Promise<RunLogEvent[]> {
    await this.logWrites.get(runId)
    const text = await readFile(this.logPath(runId), 'utf8').catch(() => '')
    return text
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as RunLogEvent]
        } catch {
          return []
        }
      })
  }

  view(runId: string): AgentRunView | null {
    const r = this.deps.db.get<{
      id: string
      task_page_id: string
      project_id: string
      mode: RunMode
      command: string | null
      status: RunStatus
      started_at: string
      ended_at: string | null
      cost: number | null
      summary: string | null
      input_text: string | null
    }>('SELECT * FROM agent_runs WHERE id = ?', runId)
    if (!r) return null
    const wt = this.deps.worktrees.get(r.task_page_id)
    return {
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_page_id,
      mode: r.mode,
      command: r.command,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      costUsd: r.cost,
      text: r.input_text,
      branch: wt?.branch ?? null,
      worktreePath: wt?.path ?? null,
      summary: r.summary ? (JSON.parse(r.summary) as RunSummary) : null
    }
  }

  // ---------- Interno ----------

  private pump(): void {
    while (this.active.size < this.maxParallel && this.queue.length > 0) {
      const run = this.queue.shift()!
      this.active.set(run.id, run)
      run.start().catch(() => {
        void this.finish(run, 'failed', 'Não foi possível iniciar o Claude Code.')
      })
    }
  }

  private async onPermission(run: ActiveRun, req: BridgeRequest): Promise<BridgeDecision> {
    if (run.cancelled) return { behavior: 'deny', message: RUN_MESSAGES.cancelled }
    const command = typeof req.input['command'] === 'string' ? req.input['command'] : ''
    const currentBranch =
      run.delivery && req.toolName === 'Bash' && /\bpush\b/.test(command)
        ? await this.deps.currentBranch?.(run.worktree.path).catch(() => null)
        : null
    const decision = evaluatePermission(
      { tool: req.toolName, input: req.input },
      {
        worktree: run.worktree.path,
        allowRules: this.allowRules(run.projectId),
        aliases: run.aliases,
        delivery: run.delivery
          ? {
              target: run.delivery.target,
              requirePushApproval: run.delivery.requirePushApproval,
              granted: run.granted,
              pushDefault: run.pushDefault,
              currentBranch: currentBranch ?? null
            }
          : null
      }
    )
    const requestId = req.toolUseId ?? randomUUID()
    const summary =
      req.toolName === 'Bash' && typeof req.input['command'] === 'string'
        ? req.input['command'].slice(0, 300)
        : typeof req.input['file_path'] === 'string'
          ? req.input['file_path']
          : req.toolName
    if (decision.decision === 'allow') {
      if (decision.reason) {
        this.log(run, {
          kind: 'permission',
          requestId,
          tool: req.toolName,
          summary,
          state: 'allowed',
          reason: decision.reason
        })
      }
      if (decision.delivery) this.deliveryEvents(run, decision.delivery, summary)
      return { behavior: 'allow' }
    }
    if (decision.decision === 'deny') {
      this.log(run, {
        kind: 'permission',
        requestId,
        tool: req.toolName,
        summary,
        state: 'blocked',
        reason: decision.reason
      })
      this.taskEvent(run, 'run_blocked', { tool: req.toolName, reason: decision.reason })
      return { behavior: 'deny', message: decision.reason }
    }
    return new Promise<BridgeDecision>((resolve) => {
      const timer = setTimeout(() => {
        const p = run.pending.get(requestId)
        if (!p) return
        this.log(run, {
          kind: 'permission',
          requestId,
          tool: req.toolName,
          summary,
          state: 'denied',
          reason: RUN_MESSAGES.timeout
        })
        this.resolvePending(run, requestId, p, { behavior: 'deny', message: RUN_MESSAGES.timeout })
      }, this.approvalTimeoutMs)
      run.pending.set(requestId, {
        resolve,
        timer,
        since: this.now().toISOString(),
        kind: decision.decision === 'question' ? 'question' : 'permission',
        tool: req.toolName,
        summary,
        input: req.input,
        suggestion: decision.decision === 'ask' ? decision.suggestion : null,
        delivery: decision.decision === 'ask' ? (decision.delivery ?? null) : null
      })
      if (decision.decision === 'question') {
        const questions = Array.isArray(req.input['questions'])
          ? (req.input['questions'] as Record<string, unknown>[]).map((q) => ({
              question: typeof q['question'] === 'string' ? q['question'] : '',
              options: Array.isArray(q['options'])
                ? (q['options'] as Record<string, unknown>[]).map((o) => String(o['label'] ?? ''))
                : [],
              multiSelect: q['multiSelect'] === true
            }))
          : []
        this.log(run, { kind: 'question', requestId, questions, state: 'pending' })
        this.deps.notify(
          'O Claude Code tem uma pergunta',
          questions[0]?.question ?? 'Responda no Orkio.',
          run
        )
      } else {
        this.log(run, {
          kind: 'permission',
          requestId,
          tool: req.toolName,
          summary,
          state: 'pending',
          ...(decision.delivery ? { delivery: true } : { suggestion: decision.suggestion })
        })
        this.deps.notify(
          decision.delivery
            ? 'Entrega: o Claude Code pede aprovação'
            : 'O Claude Code pede aprovação',
          summary,
          run
        )
      }
    })
  }

  private resolvePending(
    run: ActiveRun,
    requestId: string,
    p: Pending,
    decision: BridgeDecision
  ): void {
    clearTimeout(p.timer)
    run.pending.delete(requestId)
    p.resolve(decision)
  }

  private onEvent(run: ActiveRun, event: RunLogEvent): void {
    // O agente leu/escreveu um .env: os valores dele passam a ser escondidos dali em diante.
    if (event.kind === 'tool' && event.file && isEnvFile(event.file)) {
      this.readEnvSecrets(run, resolve(run.worktree.path, event.file))
    }
    if (event.kind === 'tool' && event.tool === 'Bash' && TEST_COMMAND.test(event.summary)) {
      run.tests.add(event.summary.slice(0, 120))
    }
    if (event.kind === 'result') {
      run.costUsd = event.costUsd
      run.ok = event.ok
      run.resultText = event.text.slice(0, 20_000)
    }
    this.log(run, event)
  }

  private async onExit(
    run: ActiveRun,
    result: { code: number | null; signal: NodeJS.Signals | null; stderr: string }
  ): Promise<void> {
    for (const [requestId, p] of run.pending) {
      this.resolvePending(run, requestId, p, { behavior: 'deny', message: RUN_MESSAGES.cancelled })
    }
    const status: RunStatus = run.cancelled
      ? 'cancelled'
      : run.ok === true && result.code === 0
        ? 'succeeded'
        : 'failed'
    const message =
      status === 'failed'
        ? result.stderr.trim()
          ? `O Claude Code terminou com erro: ${result.stderr.trim().slice(-300)}`
          : 'O Claude Code terminou com erro.'
        : status === 'cancelled'
          ? RUN_MESSAGES.cancelled
          : undefined
    await this.finish(run, status, message)
  }

  private async finish(run: ActiveRun, status: RunStatus, message?: string): Promise<void> {
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return
    if (run.timer) clearTimeout(run.timer)
    // Tempo esgotado: cancelado por nós, mas para quem pediu é falha.
    if (run.timedOut) {
      status = 'failed'
      message = RUN_MESSAGES.timedOut
    }
    run.status = status
    this.active.delete(run.id)
    let summary: RunSummary | null = null
    try {
      const diff = await this.deps.git.diffStat(run.worktree.path, run.worktree.baseRef)
      const commits = await this.deps.git.commitsSince(run.worktree.path, run.worktree.baseRef)
      summary = {
        files: diff.files.filter((f) => !f.startsWith('.orkio/')),
        diffStat: diff.stat,
        commits,
        tests: [...run.tests]
      }
    } catch {
      // Worktree removido ou git indisponível: sem resumo.
    }
    this.deps.db.run(
      'UPDATE agent_runs SET status = ?, ended_at = ?, cost = ?, summary = ? WHERE id = ?',
      status,
      this.now().toISOString(),
      run.costUsd,
      summary ? JSON.stringify(summary) : null,
      run.id
    )
    this.log(run, { kind: 'status', status, ...(message ? { message } : {}) })
    this.taskEvent(
      run,
      status === 'succeeded'
        ? 'run_finished'
        : status === 'cancelled'
          ? 'run_cancelled'
          : 'run_failed',
      { files: summary?.files.length ?? 0, costUsd: run.costUsd }
    )
    await this.prune(run.taskId)
    const finished: RunFinished = {
      runId: run.id,
      taskId: run.taskId,
      status,
      resultText: scrubText(run.resultText, run.secrets),
      summary,
      costUsd: run.costUsd,
      message: message ?? null
    }
    for (const listener of this.finishListeners) {
      try {
        listener(finished)
      } catch {
        // quem ouve não derruba a execução
      }
    }
    this.pump()
  }

  /** Avisa quando uma execução termina (sucesso, falha ou cancelamento). */
  onFinished(listener: (info: RunFinished) => void): () => void {
    this.finishListeners.add(listener)
    return () => this.finishListeners.delete(listener)
  }

  private setStatus(run: ActiveRun, status: RunStatus): void {
    this.deps.db.run('UPDATE agent_runs SET status = ? WHERE id = ?', status, run.id)
    this.log(run, { kind: 'status', status })
  }

  /** .env* na raiz do worktree (antes de rodar). */
  private collectEnvSecrets(run: ActiveRun, dir: string): void {
    try {
      for (const name of readdirSync(dir)) {
        if (isEnvFile(name)) this.readEnvSecrets(run, join(dir, name))
      }
    } catch {
      // sem acesso: nada a coletar
    }
  }

  private readEnvSecrets(run: ActiveRun, path: string): void {
    if (!isInside(path, run.worktree.path)) return
    try {
      if (statSync(path).size > 64 * 1024) return
      for (const v of envFileValues(readFileSync(path, 'utf8'))) run.secrets.add(v)
    } catch {
      // arquivo sumiu/ilegível
    }
  }

  private log(run: ActiveRun, event: RunLogEvent): void {
    event = scrubEvent(event, run.secrets)
    // Escritas encadeadas por execução: a ordem do arquivo é a ordem dos eventos.
    const line = `${JSON.stringify(event)}\n`
    const path = this.logPath(run.id)
    const prev = this.logWrites.get(run.id) ?? Promise.resolve()
    const next = prev.then(() => appendFile(path, line, { mode: 0o600 })).catch(() => undefined)
    this.logWrites.set(run.id, next)
    void next.then(() => {
      if (this.logWrites.get(run.id) === next) this.logWrites.delete(run.id)
    })
    this.deps.emit({ runId: run.id, projectId: run.projectId, taskId: run.taskId, event })
  }

  private logPath(runId: string): string {
    return join(this.deps.runsDir, `${runId.replace(/[^A-Za-z0-9-]/g, '')}.jsonl`)
  }

  /** Histórico: cada push/PR/comentário/resolução liberado no modo entrega (com link). */
  private deliveryEvents(run: ActiveRun, actions: DeliveryAction[], command: string): void {
    const t = run.delivery?.target
    if (!t) return
    const seen = new Set<DeliveryEvent>()
    for (const a of actions) {
      if (!a.event || seen.has(a.event)) continue
      seen.add(a.event)
      const pr = a.event === 'push' ? null : (this.deps.prFor?.(run.projectId, t.branch) ?? null)
      this.taskEvent(run, 'delivery', {
        action: a.event,
        by: 'claude',
        command: scrubText(command, run.secrets).slice(0, 200),
        owner: t.owner,
        repo: t.repo,
        branch: t.branch,
        ...(pr !== null ? { pr: { number: pr, owner: t.owner, repo: t.repo } } : {})
      })
    }
  }

  private taskEvent(
    run: ActiveRun,
    kind:
      'run_started' | 'run_finished' | 'run_cancelled' | 'run_failed' | 'run_blocked' | 'delivery',
    detail: Record<string, unknown>
  ): void {
    this.deps.store.addEvent({
      taskPageId: run.taskId,
      projectId: run.projectId,
      at: this.now().toISOString(),
      kind,
      source: 'manual',
      fromStage: null,
      toStage: null,
      detail: { runId: run.id, ...detail }
    })
  }

  private async writeBriefing(worktree: string, briefing: string): Promise<void> {
    await mkdir(join(worktree, '.orkio'), { recursive: true })
    await writeFile(join(worktree, '.orkio', 'briefing.md'), briefing, 'utf8')
    // Exclusão local do git (no worktree, `.git` é um arquivo; usamos o .gitignore local da pasta).
    await writeFile(join(worktree, '.orkio', '.gitignore'), '*\n', 'utf8')
  }

  /** Mantém só os `keepPerTask` logs mais recentes da tarefa. */
  private async prune(taskId: string): Promise<void> {
    const old = this.deps.db.all<{ id: string }>(
      'SELECT id FROM agent_runs WHERE task_page_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET ?',
      taskId,
      this.keepPerTask
    )
    for (const r of old) await rm(this.logPath(r.id), { force: true }).catch(() => undefined)
  }
}

/** Aplica a redação de segredos em todos os textos do evento (antes do disco e da tela). */
function scrubEvent(event: RunLogEvent, secrets: ReadonlySet<string>): RunLogEvent {
  const clean = (v: unknown): unknown =>
    typeof v === 'string'
      ? redactValues(redactSecrets(v), secrets)
      : Array.isArray(v)
        ? v.map(clean)
        : typeof v === 'object' && v !== null
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, k === 'requestId' || k === 'id' ? x : clean(x)])
            )
          : v
  return clean(event) as RunLogEvent
}

function scrubText(text: string, secrets: ReadonlySet<string>): string {
  return redactValues(redactSecrets(text), secrets)
}

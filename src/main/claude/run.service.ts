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
import type { TaskEventDetailInput } from '../../shared/task-events'
import { isSessionUuid } from '../../shared/terminal'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  ACTIVE_RUN_STATUSES,
  type AgentRunView,
  type PermissionAnswer,
  type RunLogEvent,
  type RunMode,
  type RunStatus,
  type RunSummary
} from '../../shared/agent-run'
import { BRIEFING_PATH, isScratchPath } from '../../shared/orkio-scratch'
import type { BoardStore, TaskEventInput } from '../board/board.store'
import type { Db } from '../db/database'
import { DomainError } from '../errors'
import type { Git } from '../git/git'
import type { DeliveryEvent, DeliveryKind } from './delivery-policy'
import { CLAUDE_MODELS, EFFORT_LABELS } from '../../shared/agent-runtime'
import {
  DELIVERY_ALLOWED,
  decidePermission,
  isInside,
  type AllowRule,
  type DeliveryAction,
  type PolicyAliases
} from './policy'
import { envFileValues, isEnvFile, redactSecrets, redactValues } from '../platform/redact'
import { MEMORY_MESSAGES } from '../../shared/agent-memory'
import { NO_EXTRAS, type RunExtras } from '../mcp/run-extras'
import {
  deliveryOf,
  runInputRecord,
  type RunInput,
  type RunSession,
  type RunSpec
} from './run-spec'
import {
  PermissionBroker,
  type BridgeDecision,
  type BridgeRememberReply,
  type BridgeRequest
} from './runner'
import { ensureScratch } from './scratch'
import { summarizeTool } from './stream'
import type { WorktreeRecord, WorktreeService } from './worktree.service'

export type { RunAgent, RunSpec } from './run-spec'

type RunEventKind =
  'run_started' | 'run_finished' | 'run_cancelled' | 'run_failed' | 'run_blocked' | 'delivery'
export interface RunHandle {
  start(): Promise<void>
  cancel(): void
}

const ACTIVE_RUN_SQL = `(${ACTIVE_RUN_STATUSES.map((s) => `'${s}'`).join(', ')})`

export interface RunServiceDeps {
  db: Db
  store: BoardStore
  worktrees: WorktreeService
  git: Pick<Git, 'diffStat' | 'commitsSince'>
  /** Cria o processo do Claude Code (real: ClaudeRun; testes: falso). */
  createRun(options: {
    /** A execução: o processo monta os argumentos do CLI dela (`buildCliArgs`). */
    spec: RunSpec
    cwd: string
    prompt: string
    /** Id da sessão (o da sessão retomada, no `--resume`). */
    sessionId: string
    broker: PermissionBroker
    /** Fase 4: servidores MCP, segredos do agente e skills negadas desta execução. */
    extras: RunExtras
    onEvent(event: RunLogEvent): void
    onExit(result: { code: number | null; signal: NodeJS.Signals | null; stderr: string }): void
  }): RunHandle
  /**
   * Fase 4: resolve na hora de rodar o que a configuração acrescenta (servidores MCP do Orkio,
   * segredos do agente, skills desligadas). Sem isto, nada a mais.
   */
  extras?(run: { projectId: string; agentKey: string | null }): Promise<RunExtras>
  /** Aliases do git/gh e `push.default`, lidos no começo da execução (política). */
  policyInputs(dir: string): Promise<{ aliases: PolicyAliases; pushDefault: string | null }>
  /** Branch atual do worktree; a política pede quando precisa (push no modo entrega). */
  currentBranch(dir: string): Promise<string | null>
  /** Número da PR aberta da branch (sinais da 2D), para o link no histórico. */
  prFor?(projectId: string, branch: string): number | null
  runsDir: string
  emit(message: { runId: string; projectId: string; taskId: string; event: RunLogEvent }): void
  /** Notificação de desktop (pedido de aprovação/pergunta). */
  notify(title: string, body: string, ref: { projectId: string; taskId: string }): void
  /**
   * Memória do agente (Fase 3): grava a nota da ferramenta `lembrar` (o store valida e redige).
   * Sem isto, a ferramenta responde que a memória não está ligada.
   */
  remember?(
    agentKey: string,
    projectId: string,
    input: Record<string, unknown>
  ): Promise<{ ok: true; text: string; message: string } | { ok: false; message: string }>
  maxParallel?: number
  keepPerTask?: number
  approvalTimeoutMs?: number
  /** Pergunta do Claude (AskUserQuestion): espera bem mais que uma permissão (padrão 24 h). */
  questionTimeoutMs?: number
  now?: () => Date
  newId?: () => string
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
  /** Código do motivo (`null` = sucesso); o fluxo guarda no passo para a tela de problema. */
  code: RunEndCode | null
}

export type RunEndCode = 'timed_out' | 'claude_error' | 'start_failed' | 'cancelled'

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
  /** Total bruto da sessão no `result` (acumulado no --resume). */
  sessionCostTotal: number | null
  /** Sessão continuada por esta execução (`--resume`), se houver. */
  resumedSession: string | null
  ok: boolean | null
  resultText: string
  timer: NodeJS.Timeout | null
  timedOut: boolean
  /** Valores lidos de arquivos .env do worktree: escondidos em tudo que vai para o log. */
  secrets: Set<string>
  spec: RunSpec
  /** Categorias do modo entrega (5C) já aprovadas nesta execução. */
  granted: Set<DeliveryKind>
  aliases: PolicyAliases
  pushDefault: string | null
  start: () => Promise<void>
}

export class RunBusyError extends DomainError {
  constructor() {
    super('busy', RUN_MESSAGES.busy)
    this.name = 'RunBusyError'
  }
}

export const RUN_MESSAGES = {
  busy: 'Esta tarefa já tem uma execução em andamento. Espere terminar ou cancele.',
  timeout: 'Sem resposta no prazo: o Orkio negou o pedido.',
  denied: 'Negado por você no Orkio.',
  cancelled: 'Execução cancelada.',
  notFound: 'Execução não encontrada.',
  timedOut: 'Tempo limite esgotado: o Orkio cancelou a execução.'
} as const

const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|e2e|vitest|jest)\b|\b(vitest|jest|pytest|go test|cargo test|playwright test)\b/

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
  private readonly questionTimeoutMs: number

  constructor(private readonly deps: RunServiceDeps) {
    this.maxParallel = deps.maxParallel ?? 2
    this.keepPerTask = deps.keepPerTask ?? 10
    this.approvalTimeoutMs = deps.approvalTimeoutMs ?? 10 * 60_000
    this.questionTimeoutMs = deps.questionTimeoutMs ?? 24 * 60 * 60_000
    // Execuções que ficaram "em andamento" (app fechado/derrubado): o processo não existe mais.
    deps.db.run(
      `UPDATE agent_runs SET status = 'failed', ended_at = ? WHERE status IN ${ACTIVE_RUN_SQL}`,
      this.now().toISOString()
    )
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /**
   * Texto enviado ao Claude: o pedido ou o comando instalado + argumentos e, numa sessão nova com
   * `includeBriefing`, o briefing junto. Sessão retomada já leu o briefing: só o pedido.
   */
  static composePrompt(input: RunInput, session: RunSession): string {
    const brief = `Briefing da tarefa (também em ${BRIEFING_PATH} no worktree):\n\n${
      session.kind === 'new' ? session.briefing : ''
    }`
    const withBriefing = session.kind === 'new' && session.includeBriefing
    if (input.kind === 'command') {
      const args = input.args.trim()
      const line = `/${input.name}${args ? ` ${args}` : ''}`
      // Sem o briefing: o comando recebe só os argumentos ($ARGUMENTS), ex.: um task-ID.
      return withBriefing ? `${line}\n\n${brief}` : line
    }
    if (!withBriefing) return input.text.trim()
    return `${input.text.trim()}\n\n---\n\n${brief}`
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

  /**
   * Execuções rodando ou na fila (em memória): Visão geral (6D), manter acordado, atualização (6C:
   * não reinicia por cima delas) e desligamento.
   */
  activeRuns(): {
    runId: string
    projectId: string
    taskId: string
    status: RunStatus
    queued: boolean
  }[] {
    const view = (r: ActiveRun, queued: boolean) => ({
      runId: r.id,
      projectId: r.projectId,
      taskId: r.taskId,
      status: r.status,
      queued
    })
    return [
      ...[...this.active.values()].map((r) => view(r, false)),
      ...this.queue.map((r) => view(r, true))
    ]
  }

  /** A tarefa tem execução da sessão principal rodando ou na fila (sidechats não contam). */
  isRunning(taskId: string): boolean {
    return [...this.active.values(), ...this.queue].some((r) => r.taskId === taskId && !r.spec.side)
  }

  /** Um sidechat da tarefa está rodando ou na fila (um por vez). */
  isSideRunning(taskId: string): boolean {
    return [...this.active.values(), ...this.queue].some(
      (r) => r.taskId === taskId && !!r.spec.side
    )
  }

  /** Inicia (ou enfileira) uma execução. O worktree precisa ter sido preparado antes. */
  async start(spec: RunSpec): Promise<AgentRunView> {
    if (spec.side ? this.isSideRunning(spec.task.id) : this.isRunning(spec.task.id)) {
      throw new RunBusyError()
    }
    const worktree = this.deps.worktrees.get(spec.task.id)
    if (!worktree) throw new Error('Prepare o ambiente da tarefa antes de rodar.')
    const id = this.deps.newId?.() ?? randomUUID()
    const startedAt = this.now().toISOString()
    const resume = spec.session.kind === 'resume'
    const sessionId = spec.session.kind === 'resume' ? spec.session.id : randomUUID()
    // `fork_json`: de onde a sessão saiu e se é um sidechat (marcado só na primeira execução dela).
    const forkPoint =
      spec.session.kind === 'fork' ? { session: spec.session.from, at: spec.session.at } : null
    const fork =
      forkPoint || spec.side
        ? JSON.stringify({ ...(forkPoint ?? {}), ...(spec.side ? { side: true } : {}) })
        : null
    const { runtime, agent } = spec
    const record = runInputRecord(spec.input)
    const delivery = deliveryOf(spec)
    this.deps.db.run(
      `INSERT INTO agent_runs (id, task_page_id, project_id, mode, command, status, started_at, input_text, agent_key, session_id, fork_json)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      id,
      spec.task.id,
      spec.project.id,
      record.mode,
      record.command,
      startedAt,
      redactSecrets(record.text).slice(0, 20_000),
      agent?.key ?? null,
      sessionId,
      fork
    )
    await mkdir(this.deps.runsDir, { recursive: true })

    const run: ActiveRun = {
      id,
      projectId: spec.project.id,
      taskId: spec.task.id,
      handle: null,
      worktree,
      status: 'queued',
      cancelled: false,
      pending: new Map(),
      tests: new Set(),
      costUsd: null,
      sessionCostTotal: null,
      resumedSession: resume ? sessionId : null,
      ok: null,
      resultText: '',
      timer: null,
      timedOut: false,
      secrets: new Set(),
      spec,
      granted: new Set(),
      aliases: {},
      pushDefault: null,
      start: async () => {
        run.status = 'running'
        this.setStatus(run, 'running')
        this.taskEvent(run, 'run_started', {
          mode: record.mode,
          command: record.command,
          ...(resume ? { resumed: true } : {}),
          ...(agent ? { agent: agent.name, agentKey: agent.key } : {})
        })
        // Briefing também em arquivo, na pasta de rascunho (fora do git).
        if (spec.session.kind === 'new') {
          await this.writeBriefing(worktree.path, spec.session.briefing).catch(() => undefined)
        }
        this.collectEnvSecrets(run, worktree.path)
        const inputs = await this.deps.policyInputs(worktree.path).catch(() => null)
        if (inputs) {
          run.aliases = inputs.aliases
          run.pushDefault = inputs.pushDefault
        }
        if (delivery) {
          const t = delivery.target
          this.log(run, {
            kind: 'text',
            text: `Modo entrega ligado neste passo: push só de ${t.branch} (${t.remote}) e GitHub CLI só em ${t.owner}/${t.repo}.`
          })
        }
        if (spec.session.kind === 'fork') {
          this.log(run, {
            kind: 'info',
            text: spec.side
              ? 'Sidechat: conversa ao lado da sessão principal, só de leitura. A sessão principal não muda.'
              : spec.session.reason === 'edit'
                ? 'Mensagem editada: a conversa voltou até antes dela (os arquivos da pasta de trabalho continuam como estão).'
                : 'Ramificada de uma resposta anterior: conversa nova a partir dali (os arquivos da pasta de trabalho continuam como estão).'
          })
        }
        if (spec.access.tools === 'read_only') {
          this.log(run, {
            kind: 'info',
            text: 'Só leitura neste passo: o Claude Code não pode editar arquivos e todo comando pede sua aprovação.'
          })
        }
        if (agent) {
          this.log(run, {
            kind: 'text',
            text: `Rodando como ${agent.name}: instruções do agente no início da conversa. As permissões são as mesmas do Orkio.`
          })
        }
        if (runtime.model || runtime.effort) {
          const parts: string[] = []
          if (runtime.model) {
            const label = CLAUDE_MODELS.find((m) => m.id === runtime.model)?.label ?? runtime.model
            parts.push(`Modelo: ${label}`)
          }
          if (runtime.effort) parts.push(`Raciocínio: ${EFFORT_LABELS[runtime.effort]}`)
          this.log(run, { kind: 'info', text: parts.join(' · ') })
        }
        // Fase 4: os valores dos segredos entram no filtro do log antes de qualquer saída do CLI.
        const extras = await (
          this.deps.extras?.({
            projectId: spec.project.id,
            agentKey: agent?.key ?? null
          }) ?? Promise.resolve(NO_EXTRAS)
        ).catch((): RunExtras => ({
          ...NO_EXTRAS,
          notes: ['Não deu para carregar os servidores MCP e segredos do Orkio nesta execução.']
        }))
        for (const v of extras.secretValues) run.secrets.add(v)
        for (const text of extras.notes) this.log(run, { kind: 'info', text })
        const broker = new PermissionBroker(
          (req) => this.onPermission(run, req),
          (input) => this.onRemember(run, input)
        )
        await broker.open()
        run.handle = this.deps.createRun({
          spec,
          cwd: worktree.path,
          prompt: RunService.composePrompt(spec.input, spec.session),
          sessionId,
          broker,
          extras,
          onEvent: (event) => this.onEvent(run, event),
          onExit: (result) => void this.onExit(run, result)
        })
        await run.handle.start()
        const timeoutMin = spec.timeoutMin
        if (timeoutMin && timeoutMin > 0) {
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
          }, timeoutMin * 60_000)
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
    for (const id of [...this.queue.map((r) => r.id), ...this.active.keys()]) this.cancel(id)
  }

  /** Cancela a execução (na fila ou rodando); já terminada = nada a fazer. */
  cancel(runId: string): void {
    const queued = this.queue.findIndex((r) => r.id === runId)
    if (queued >= 0) {
      const [run] = this.queue.splice(queued, 1)
      run!.cancelled = true
      void this.finish(run!, 'cancelled', RUN_MESSAGES.cancelled)
      return
    }
    const run = this.active.get(runId)
    if (!run) return
    run.cancelled = true
    for (const [requestId, p] of run.pending)
      this.resolvePending(run, requestId, p, { behavior: 'deny', message: RUN_MESSAGES.cancelled })
    run.handle?.cancel()
  }

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

  /** Fase 4: decisões "sempre neste projeto" de todos os projetos (Configurações › Geral). */
  rememberedRules(): { projectId: string; tool: string; pattern: string; createdAt: string }[] {
    return this.deps.db
      .all<{ project_id: string; tool: string; pattern: string; created_at: string }>(
        'SELECT project_id, tool, pattern, created_at FROM permission_rules ORDER BY created_at DESC LIMIT 500'
      )
      .map((r) => ({
        projectId: r.project_id,
        tool: r.tool,
        pattern: r.pattern,
        createdAt: r.created_at
      }))
  }

  /** Fase 4: revoga uma decisão lembrada (o próximo pedido igual volta a perguntar). */
  revokeRule(projectId: string, tool: string, pattern: string): void {
    this.deps.db.run(
      'DELETE FROM permission_rules WHERE project_id = ? AND tool = ? AND pattern = ?',
      projectId,
      tool,
      pattern
    )
  }

  allowRules(projectId: string): AllowRule[] {
    return this.deps.db.all<AllowRule>(
      'SELECT tool, pattern FROM permission_rules WHERE project_id = ?',
      projectId
    )
  }

  /**
   * Sessão mais recente da tarefa. `excludeAgent`: ignora as execuções desse agente (o revisor da
   * Fase 1 roda em sessão própria; quem implementa continua a dele).
   */
  lastSession(taskId: string, excludeAgent?: string): string | null {
    // Sidechats nunca são a sessão da tarefa: ficam fora (a marca está na 1ª execução deles).
    const notSide = `AND session_id NOT IN (SELECT session_id FROM agent_runs WHERE task_page_id = ? AND session_id IS NOT NULL AND ${SIDE_SQL})`
    const sql = excludeAgent
      ? `SELECT session_id FROM agent_runs WHERE task_page_id = ? AND session_id IS NOT NULL AND (agent_key IS NULL OR agent_key != ?) ${notSide} ORDER BY started_at DESC LIMIT 1`
      : `SELECT session_id FROM agent_runs WHERE task_page_id = ? AND session_id IS NOT NULL ${notSide} ORDER BY started_at DESC LIMIT 1`
    return (
      this.deps.db.get<{ session_id: string }>(
        sql,
        ...(excludeAgent ? [taskId, excludeAgent, taskId] : [taskId, taskId])
      )?.session_id ?? null
    )
  }

  /** A sessão é um sidechat (a primeira execução dela foi marcada)? */
  isSideSession(sessionId: string): boolean {
    return !!this.deps.db.get<{ id: string }>(
      `SELECT id FROM agent_runs WHERE session_id = ? AND ${SIDE_SQL} LIMIT 1`,
      sessionId
    )
  }

  /** O último ponto da conversa de uma sessão (a resposta mais recente com id), para ramificar. */
  async lastPoint(sessionId: string): Promise<{ session: string; at: string } | null> {
    const rows = this.deps.db.all<{ id: string }>(
      'SELECT id FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC',
      sessionId
    )
    for (const r of rows) {
      const last = (await this.readLog(r.id))
        .filter((e): e is Extract<RunLogEvent, { kind: 'text' }> => e.kind === 'text')
        .findLast((e) => e.uuid)
      if (last?.uuid) return { session: sessionId, at: last.uuid }
    }
    return null
  }

  /** A sessão é desta tarefa (o campo pode continuar uma sessão escolhida na lista "Sessões")? */
  hasSession(taskId: string, sessionId: string): boolean {
    return !!this.deps.db.get<{ id: string }>(
      'SELECT id FROM agent_runs WHERE task_page_id = ? AND session_id = ? LIMIT 1',
      taskId,
      sessionId
    )
  }

  /**
   * Fase 2, "Ramificar daqui": a resposta `at` é desta execução? Devolve a sessão dela e o ponto.
   */
  async pointIn(runId: string, at: string): Promise<{ session: string; at: string } | null> {
    const r = this.deps.db.get<{ session_id: string | null }>(
      'SELECT session_id FROM agent_runs WHERE id = ?',
      runId
    )
    if (!r?.session_id) return null
    const log = await this.readLog(runId)
    return log.some((e) => e.kind === 'text' && e.uuid === at)
      ? { session: r.session_id, at }
      : null
  }

  /**
   * Fase 2, "Editar mensagem": onde a conversa estava logo antes do pedido desta execução: a última
   * resposta das execuções anteriores da mesma sessão ou, na primeira de uma sessão ramificada, o
   * ponto de onde ela saiu. `null` = o pedido abriu a sessão (editar = sessão nova).
   */
  async pointBefore(runId: string): Promise<{ session: string; at: string } | null> {
    const r = this.deps.db.get<{ session_id: string | null; started_at: string }>(
      'SELECT session_id, started_at FROM agent_runs WHERE id = ?',
      runId
    )
    if (!r?.session_id) return null
    const before = this.deps.db.all<{ id: string; fork_json: string | null }>(
      'SELECT id, fork_json FROM agent_runs WHERE session_id = ? AND (started_at < ? OR id = ?) ORDER BY started_at DESC',
      r.session_id,
      r.started_at,
      runId
    )
    for (const p of before) {
      if (p.id === runId) continue
      const last = (await this.readLog(p.id))
        .filter((e): e is Extract<RunLogEvent, { kind: 'text' }> => e.kind === 'text')
        .findLast((e) => e.uuid)
      if (last?.uuid) return { session: r.session_id, at: last.uuid }
    }
    // A sessão começou ramificada: o ponto de antes é o de onde ela saiu.
    const first = before.at(-1)
    return first?.fork_json ? parseForkPoint(first.fork_json) : null
  }

  // ---------- Consultas de quem não é dono de `agent_runs` (visão geral, agentes, diagnóstico) ----------

  /** Início e comando de cada execução (lista "Rodando"). */
  startInfo(ids: readonly string[]): Map<string, { startedAt: string; command: string | null }> {
    if (ids.length === 0) return new Map()
    const rows = this.deps.db.all<{ id: string; started_at: string; command: string | null }>(
      `SELECT id, started_at, command FROM agent_runs WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids
    )
    return new Map(rows.map((r) => [r.id, { startedAt: r.started_at, command: r.command }]))
  }

  /** Custo das execuções terminadas desde `since` (`null` = desconhecido). */
  costsSince(since: string): (number | null)[] {
    return this.deps.db
      .all<{ cost: number | null }>(
        `SELECT cost FROM agent_runs WHERE started_at >= ? AND status IN ('succeeded', 'failed', 'cancelled')`,
        since
      )
      .map((r) => r.cost)
  }

  agentRunsSince(
    agentKey: string,
    since: string
  ): { count: number; costUsd: number; startedAt: string[] } {
    const rows = this.deps.db.all<{ started_at: string; cost: number | null }>(
      'SELECT started_at, cost FROM agent_runs WHERE agent_key = ? AND started_at >= ?',
      agentKey,
      since
    )
    return {
      count: rows.length,
      costUsd: rows.reduce((sum, r) => sum + (r.cost ?? 0), 0),
      startedAt: rows.map((r) => r.started_at)
    }
  }

  counts(): { total: number; active: number } {
    const n = (sql: string): number => this.deps.db.get<{ n: number }>(sql)?.n ?? 0
    return {
      total: n('SELECT COUNT(*) AS n FROM agent_runs'),
      active: n(`SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ${ACTIVE_RUN_SQL}`)
    }
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
      session_id: string | null
      fork_json: string | null
      agent_key: string | null
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
      summary: r.summary ? (JSON.parse(r.summary) as RunSummary) : null,
      hasSession: r.session_id !== null,
      agentKey: r.agent_key,
      sessionId: r.session_id,
      forkedFrom: r.fork_json ? (parseForkPoint(r.fork_json)?.session ?? null) : null,
      side: r.session_id !== null && this.isSideSession(r.session_id)
    }
  }

  private pump(): void {
    while (this.active.size < this.maxParallel && this.queue.length > 0) {
      const run = this.queue.shift()!
      this.active.set(run.id, run)
      run.start().catch(() => {
        void this.finish(run, 'failed', 'Não foi possível iniciar o Claude Code.', 'start_failed')
      })
    }
  }

  /**
   * Ferramenta `lembrar` (memória do agente): só com agente; o texto passa pela redação desta
   * execução (inclusive os valores dos `.env`) antes do store, e a nota anotada vira linha `info`.
   */
  private async onRemember(
    run: ActiveRun,
    input: Record<string, unknown>
  ): Promise<BridgeRememberReply> {
    const agent = run.spec.agent
    if (!agent || !this.deps.remember) return { ok: false, message: MEMORY_MESSAGES.noAgent }
    if (run.cancelled) return { ok: false, message: RUN_MESSAGES.cancelled }
    const clean =
      typeof input['texto'] === 'string'
        ? { ...input, texto: scrubText(input['texto'], run.secrets) }
        : input
    const r = await this.deps.remember(agent.key, run.projectId, clean)
    if (r.ok) this.log(run, { kind: 'info', text: `Anotou na memória: ${r.text}` })
    return { ok: r.ok, message: r.message }
  }

  private async onPermission(run: ActiveRun, req: BridgeRequest): Promise<BridgeDecision> {
    if (run.cancelled) return { behavior: 'deny', message: RUN_MESSAGES.cancelled }
    const delivery = deliveryOf(run.spec)
    const github = run.spec.access.github
    const decision = await decidePermission(
      { tool: req.toolName, input: req.input },
      {
        worktree: run.worktree.path,
        allowRules: this.allowRules(run.projectId),
        aliases: run.aliases,
        repo: github?.mode === 'read' ? github.target : null,
        readOnly: run.spec.access.tools === 'read_only',
        askEdits:
          run.spec.agent?.autonomy === 'ask' || (!run.spec.agent && run.spec.askEdits === true),
        delivery: delivery
          ? {
              target: delivery.target,
              requirePushApproval: delivery.requirePushApproval,
              granted: run.granted,
              pushDefault: run.pushDefault
            }
          : null
      },
      {
        currentBranch: () => this.deps.currentBranch(run.worktree.path)
      }
    )
    const requestId = req.toolUseId ?? randomUUID()
    const summary =
      summarizeTool(req.toolName, req.input, run.worktree.path).summary || req.toolName
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
        reason: decision.reason,
        code: decision.code
      })
      this.taskEvent(run, 'run_blocked', { tool: req.toolName, reason: decision.reason })
      return { behavior: 'deny', message: decision.reason }
    }
    return new Promise<BridgeDecision>((resolve) => {
      const timer = setTimeout(
        () => {
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
          this.resolvePending(run, requestId, p, {
            behavior: 'deny',
            message: RUN_MESSAGES.timeout
          })
        },
        decision.decision === 'question' ? this.questionTimeoutMs : this.approvalTimeoutMs
      )
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
      // `total_cost_usd` é o acumulado da sessão: no --resume, o custo desta execução é a diferença.
      const raw = event.costUsd
      run.sessionCostTotal = raw
      run.costUsd = raw === null ? null : this.runCost(run, raw)
      event = { ...event, costUsd: run.costUsd }
      run.ok = event.ok
      run.resultText = event.text.slice(0, 20_000)
    }
    this.log(run, event)
  }

  private runCost(run: ActiveRun, raw: number): number {
    if (!run.resumedSession) return raw
    const prev = this.deps.db.get<{ total: number | null }>(
      'SELECT MAX(session_cost_total) AS total FROM agent_runs WHERE session_id = ? AND id != ?',
      run.resumedSession,
      run.id
    )?.total
    if (prev === null || prev === undefined || raw < prev) return raw
    return raw - prev
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
    await this.finish(run, status, message, status === 'failed' ? 'claude_error' : undefined)
  }

  private async finish(
    run: ActiveRun,
    status: RunStatus,
    message?: string,
    failedCode: RunEndCode = 'claude_error'
  ): Promise<void> {
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled') return
    if (run.timer) clearTimeout(run.timer)
    // Tempo esgotado: cancelado por nós, mas para quem pediu é falha.
    if (run.timedOut) {
      status = 'failed'
      message = RUN_MESSAGES.timedOut
    }
    const code: RunEndCode | null = run.timedOut
      ? 'timed_out'
      : status === 'failed'
        ? failedCode
        : status === 'cancelled'
          ? 'cancelled'
          : null
    run.status = status
    this.active.delete(run.id)
    let summary: RunSummary | null = null
    try {
      const diff = await this.deps.git.diffStat(run.worktree.path, run.worktree.baseRef)
      const commits = await this.deps.git.commitsSince(run.worktree.path, run.worktree.baseRef)
      summary = {
        files: diff.files.filter((f) => !isScratchPath(f)),
        diffStat: diff.stat,
        commits,
        tests: [...run.tests]
      }
    } catch {
      // Worktree removido ou git indisponível: sem resumo.
    }
    this.deps.db.run(
      'UPDATE agent_runs SET status = ?, ended_at = ?, cost = ?, session_cost_total = ?, summary = ? WHERE id = ?',
      status,
      this.now().toISOString(),
      run.costUsd,
      run.sessionCostTotal,
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
      message: message ?? null,
      code
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
    this.deps.emit({
      runId: run.id,
      projectId: run.projectId,
      taskId: run.taskId,
      event,
      ...(run.spec.side ? { side: true } : {})
    })
  }

  private logPath(runId: string): string {
    return join(this.deps.runsDir, `${runId.replace(/[^A-Za-z0-9-]/g, '')}.jsonl`)
  }

  /** Histórico: cada push/PR/comentário/resolução liberado no modo entrega (com link). */
  private deliveryEvents(run: ActiveRun, actions: DeliveryAction[], command: string): void {
    const t = deliveryOf(run.spec)?.target
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

  private taskEvent<K extends RunEventKind>(
    run: ActiveRun,
    kind: K,
    detail: Omit<TaskEventDetailInput<K>, 'runId'>
  ): void {
    this.deps.store.addEvent({
      taskPageId: run.taskId,
      projectId: run.projectId,
      at: this.now().toISOString(),
      kind,
      detail: { runId: run.id, ...detail }
    } as TaskEventInput)
  }

  private async writeBriefing(worktree: string, briefing: string): Promise<void> {
    await ensureScratch(worktree)
    await writeFile(join(worktree, BRIEFING_PATH), briefing, 'utf8')
  }

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

/** A execução abriu um sidechat (`fork_json` com `"side":true`, gravado só por nós). */
const SIDE_SQL = `fork_json LIKE '%"side":true%'`

function parseForkPoint(json: string): { session: string; at: string } | null {
  try {
    const v = JSON.parse(json) as { session?: unknown; at?: unknown }
    return isSessionUuid(v.session) && isSessionUuid(v.at) ? { session: v.session, at: v.at } : null
  } catch {
    return null
  }
}

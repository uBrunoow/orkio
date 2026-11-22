/**
 * Executor dos fluxos de tarefa (Etapa 5A). O motor é puro (`shared/task-flow.ts`); aqui ficam a
 * persistência (SQLite `flow_runs`/`flow_steps`), os passos de verdade (execuções da 4A, gates,
 * ações do Orkio), os gatilhos (entrada na etapa / botão) e a retomada depois de reiniciar.
 *
 * Regras:
 * - Um fluxo por tarefa por vez. Cada comando é uma execução da 4A (mesmo worktree e branch, mesmo
 *   limite de paralelismo).
 * - Falha nunca segue sozinha: o fluxo pausa (Retomar deste passo / Pular / Cancelar).
 * - Reiniciar: gate continua em gate; o que estava rodando (ou entre passos) vira "interrompido".
 * - Tarefa saiu da etapa: o passo atual termina, mas o fluxo só avança depois da sua escolha.
 * - Nada de conteúdo do Notion no banco: o briefing fica só em memória (refeito ao retomar).
 */
import { randomUUID } from 'node:crypto'
import {
  afterStep,
  needsYou,
  renderArgs,
  retryStep,
  skipStep,
  startFlow,
  VAR_KEY,
  type Flow,
  type ActionConfirm,
  type FlowDecision,
  type FlowPauseReason,
  type FlowRunStatus,
  type FlowRunView,
  type FlowState,
  type FlowStepStatus,
  type FlowStepView,
  type ProjectFlows,
  type Step,
  type StepEnd
} from '../../shared/task-flow'
import type { BoardStore, TaskEventKind } from '../board/board.store'
import type { StageChange } from '../board/board.service'
import type { RunFinished } from '../claude/run.service'
import { redactSecrets } from '../claude/redact'
import type { RunAgent } from '../claude/run.service'
import { buildAgentPrompt, checkAgentFlow, type AgentProfile } from '../../shared/agent'
import type { Db } from '../db/database'
import { errorName } from '../ipc/payload'

export const FLOW_MESSAGES = {
  noBinding: 'A etapa atual da tarefa não tem fluxo ligado (ou ele está desligado).',
  busy: 'Esta tarefa já tem um fluxo em andamento. Termine ou cancele antes de começar outro.',
  notFound: 'Fluxo não encontrado. Atualize a tela.',
  wrongState: 'O fluxo não está esperando essa ação. Atualize a tela.',
  flowMissing: 'O fluxo ligado a esta etapa não existe mais. Revise o Fluxo do projeto.',
  invalidStep: 'Esse passo não pode ser rodado de novo agora. Atualize a tela.',
  noBacklogTask:
    'Este passo usa a task do Backlog, mas o fluxo ainda não sabe qual é a desta tarefa. Rode o /spec de novo (ou escolha a task) e depois retome.'
} as const

export class FlowError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'FlowError'
  }
}

/** Extrator: grava variáveis do fluxo a partir do resultado de um comando. */
/** Contexto de um passo para extratores (sem segredos; o worktree é local). */
export interface ExtractContext {
  projectId: string
  taskId: string
  stepId: string
  command: string
  worktreePath: string | null
}

/** O que um extrator devolve: variáveis, falha do passo ou uma escolha para o usuário. */
export interface ExtractResult {
  vars?: Record<string, string>
  /** O passo conta como falho, com esta mensagem (o fluxo pausa). */
  fail?: string
  /** O fluxo pausa até você escolher; `resolveChoice` transforma a escolha em variáveis. */
  choose?: { prompt: string; options: { value: string; label: string }[] }
}

/** Extrator: grava variáveis do fluxo a partir do resultado (e do repositório) de um comando. */
export interface FlowExtractor {
  id: string
  label: string
  /** Antes do passo (ex.: lista de arquivos), para comparar depois. Fica só em memória. */
  snapshot?(ctx: ExtractContext): Promise<unknown>
  extract(input: {
    resultText: string
    ctx: ExtractContext
    snapshot: unknown
  }): ExtractResult | Promise<ExtractResult>
  resolveChoice?(input: { ctx: ExtractContext; value: string }): Promise<ExtractResult>
}

export interface ActionContext {
  projectId: string
  taskId: string
  vars: Record<string, string>
}

/** Ação do próprio Orkio (5C: push, conferir push, pedir review). */
export interface OrkioAction {
  id: string
  label: string
  /**
   * Ação feita à mão: o passo vira uma espera que você aprova depois (recusar cancela o fluxo).
   */
  pending?: string
  /**
   * Antes de agir: o que mostrar para você aprovar (gate da ação), `{ problem }` para falhar já
   * (o fluxo pausa) ou `null` para agir sem perguntar. Recusar encerra o fluxo como recusado.
   */
  confirm?(ctx: ActionContext): Promise<ActionConfirm | { problem: string } | null>
  run(
    ctx: ActionContext & { input?: string[] }
  ): Promise<{ ok: true; vars?: Record<string, string> } | { ok: false; message: string }>
}

export interface FlowContext {
  briefing: string
  displayId: string
  title?: string
  notionUrl: string | null
}

export interface FlowRunnerDeps {
  db: Db
  store: BoardStore
  /** Fluxos e ligações do projeto (config). */
  flows(projectId: string): ProjectFlows
  /** Etapa local atual da tarefa. */
  currentStage(projectId: string, taskId: string): string | null
  /** Monta o briefing da tarefa (Notion) e garante o worktree. */
  prepare(projectId: string, taskId: string): Promise<FlowContext>
  /** Inicia uma execução da 4A; devolve o id. Falha esperada: lance `FlowError` (mensagem pt-BR). */
  startClaude(input: {
    projectId: string
    taskId: string
    command: string
    args: string
    briefing: string
    timeoutMin: number
    includeBriefing: boolean
    /** Modo entrega (5C): só nesta execução. */
    delivery: boolean
    /** Agente (8A): instruções e modelo; nenhuma permissão a mais. */
    agent: RunAgent | null
  }): Promise<string>
  cancelClaude(runId: string): void
  extractors: readonly FlowExtractor[]
  actions: readonly OrkioAction[]
  /** Pasta do worktree da tarefa (para extratores). */
  worktreePath?: (taskId: string) => string | null
  /** Variáveis no início do fluxo (ex.: `alva.task_id` do vínculo salvo). */
  initialVars?: (projectId: string, taskId: string, flow: Flow) => Promise<Record<string, string>>
  /** Antes de começar: devolve a mensagem que impede (ex.: projeto não pronto para o alva-flow). */
  canStart?: (projectId: string, flow: Flow) => Promise<string | null>
  /**
   * Limite de fluxos com o mesmo marcador em paralelo no projeto (ex.: Alva com Docker);
   * `null` = sem limite. Excedente espera e começa sozinho quando liberar.
   */
  concurrencyLimit?: (projectId: string, flow: Flow) => number | null
  /**
   * 8A: agente atribuído à tarefa (`null` = nenhum). Lança `FlowError` (mensagem pt-BR) quando há
   * agente, mas ele não pode rodar (sem aprovação, arquivado, apagado).
   */
  agentFor?: (projectId: string, taskId: string) => Promise<FlowAgent | null>
  /** 8A: limite diário do agente atingido? Mensagem pt-BR ou `null`. */
  agentLimit?: (agent: FlowAgent) => string | null
  notify(title: string, body: string, ref: { projectId: string; taskId: string }): void
  /** Algo mudou no fluxo da tarefa (a tela recarrega). */
  emit(ref: { projectId: string; taskId: string }): void
  /** 8B: um fluxo terminou (o orquestrador decide se a tarefa segue). */
  onFinished?: (ref: { projectId: string; taskId: string; result: RunRow['result'] }) => void
  now?: () => Date
  newId?: () => string
}

/** Agente de um fluxo: a cópia do perfil feita no início (editar o perfil não muda o fluxo). */
export interface FlowAgent {
  key: string
  profile: AgentProfile
}

interface RunRow {
  id: string
  task_page_id: string
  project_id: string
  flow_id: string
  flow_json: string
  stage_id: string | null
  status: FlowRunStatus
  current_step: string | null
  state_json: string
  pause_reason: FlowPauseReason | null
  result: 'done' | 'rejected' | 'cancelled' | null
  started_at: string
  ended_at: string | null
  agent_key: string | null
  agent_json: string | null
}

interface StepRow {
  id: number
  flow_run_id: string
  step_id: string
  run_id: string | null
  status: FlowStepStatus
  started_at: string
  ended_at: string | null
  result_json: string | null
}

/** O que vai em `state_json`: só ids, chaves e valores curtos (sem conteúdo do Notion). */
interface Persisted {
  engine: FlowState
  displayId: string
  notionUrl: string | null
  /** Passo que terminou enquanto o fluxo esperava sua decisão (tarefa saiu da etapa). */
  pendingEnd?: { stepId: string; end: StepEnd } | null
  /** Escolha pedida por um extrator; `vars` já extraídas antes da escolha. */
  pendingChoice?: {
    stepId: string
    extractor: string
    prompt: string
    options: { value: string; label: string }[]
    vars: Record<string, string>
  } | null
  /** Ação do Orkio esperando sua confirmação (só metadados do git/GitHub). */
  pendingConfirm?: ActionConfirm | null
  /** 8A: você retomou depois do limite diário do agente; vale para o próximo comando. */
  limitBypass?: boolean
}

/** Ações que publicam no GitHub (a etapa pode mudar por causa delas). */
const DELIVERY_ACTION_IDS: readonly string[] = ['push', 'verify_pushed', 'request_review']

const ACTIVE: readonly FlowRunStatus[] = ['running', 'waiting_gate', 'paused', 'awaiting_decision']

export class FlowRunner {
  /** Briefing e título da tarefa por fluxo (só em memória; refeitos ao retomar). */
  private readonly briefings = new Map<string, { briefing: string; title?: string }>()
  /** Execução da 4A → passo do fluxo. */
  private readonly runIndex = new Map<string, { flowRunId: string; rowId: number }>()
  private readonly gateTimers = new Map<string, NodeJS.Timeout>()
  /** "Antes do passo" dos extratores, por execução da 4A (só em memória). */
  private readonly snapshots = new Map<string, unknown>()
  private readonly locks = new Map<string, Promise<void>>()
  /** Fechando o app: fins de execução (cancelAll) não contam; ao reabrir viram "interrompido". */
  private disposed = false

  constructor(private readonly deps: FlowRunnerDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  // ---------- Ciclo de vida ----------

  /**
   * Ao abrir o app: o que estava rodando (ou entre passos) vira "interrompido" e pausa; gate
   * continua em gate (timer rearmado); decisão pendente continua pendente.
   */
  init(): void {
    const at = this.now()
    for (const row of this.deps.db.all<RunRow>(
      `SELECT * FROM flow_runs WHERE status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision')`
    )) {
      if (row.status === 'running') {
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'interrupted', ended_at = ? WHERE flow_run_id = ? AND status = 'running'`,
          at,
          row.id
        )
        this.deps.db.run(
          `UPDATE flow_runs SET status = 'paused', pause_reason = 'interrupted' WHERE id = ?`,
          row.id
        )
        this.event(row, 'flow_paused', { reason: 'interrupted', step: row.current_step })
      } else if (row.status === 'awaiting_decision') {
        // O passo que rodava morreu com o app: quando você decidir, ele aparece interrompido.
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'interrupted', ended_at = ? WHERE flow_run_id = ? AND status = 'running'`,
          at,
          row.id
        )
      } else if (row.status === 'waiting_gate') {
        this.armGateTimer(row)
      }
    }
    // Quem esperava vaga e já pode começar (ex.: o outro fluxo terminou com o app fechado).
    this.promoteWaiting()
  }

  dispose(): void {
    this.disposed = true
    for (const t of this.gateTimers.values()) clearTimeout(t)
    this.gateTimers.clear()
  }

  // ---------- Gatilhos ----------

  /** Do BoardService (dentro da transação): adia o trabalho. */
  onStageChanged(change: StageChange): void {
    setImmediate(() => void this.handleStageChange(change))
  }

  private async handleStageChange(change: StageChange): Promise<void> {
    try {
      const active = this.activeRow(change.taskId)
      if (active && active.stage_id !== null && change.from === active.stage_id) {
        if (change.to === active.stage_id) return
        // Entrega (5C): a própria PR aberta/revisão pedida move a tarefa (automação da 3B).
        // Isso é consequência do passo, não uma decisão sua: o fluxo segue sem acompanhar a etapa.
        if (change.source === 'automation' && this.inDeliveryStep(active)) {
          this.deps.db.run(`UPDATE flow_runs SET stage_id = NULL WHERE id = ?`, active.id)
          this.deps.emit({ projectId: active.project_id, taskId: active.task_page_id })
          return
        }
        await this.leftStage(active.id)
        return
      }
      // Só entrada real dispara (nunca reconciliação, desfazer ou remoção de etapa).
      if (change.source !== 'manual' && change.source !== 'automation') return
      if (!change.to || active) return
      const binding = this.deps
        .flows(change.projectId)
        .bindings.find((b) => b.stageId === change.to && b.enabled && b.mode === 'on_enter')
      if (!binding) return
      await this.start(change.projectId, change.taskId, change.to, binding.flowId, true)
    } catch (error) {
      // Não começou ao entrar na coluna (ex.: projeto não pronto): avisa, sem quebrar o quadro.
      if (error instanceof FlowError && error.code !== 'busy') {
        this.deps.notify('O fluxo da coluna não começou', error.message, {
          projectId: change.projectId,
          taskId: change.taskId
        })
      } else {
        console.error(`[orkio] fluxo (entrada na etapa): ${errorName(error)}`)
      }
    }
  }

  /** O passo atual entrega no GitHub (comando em modo entrega ou ação push/pedir review)? */
  private inDeliveryStep(row: RunRow): boolean {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    return (
      (step?.type === 'claude_command' && step.delivery === true) ||
      (step?.type === 'orkio_action' && DELIVERY_ACTION_IDS.includes(step.action))
    )
  }

  /** Botão "Rodar fluxo": o fluxo ligado à etapa atual (ao entrar ou manual). */
  async startManual(projectId: string, taskId: string): Promise<FlowRunView> {
    const stageId = this.deps.currentStage(projectId, taskId)
    const binding = this.deps
      .flows(projectId)
      .bindings.find((b) => b.stageId === stageId && b.enabled)
    if (!stageId || !binding) throw new FlowError('no_binding', FLOW_MESSAGES.noBinding)
    return this.start(projectId, taskId, stageId, binding.flowId, true)
  }

  /**
   * Um fluxo específico, à mão (ex.: "Rodar fluxo CI vermelho" no painel). Não acompanha a etapa:
   * a tarefa pode mudar de coluna sem interromper.
   */
  async startById(projectId: string, taskId: string, flowId: string): Promise<FlowRunView> {
    return this.start(projectId, taskId, null, flowId, false)
  }

  /**
   * `useAgentFlow`: pela coluna (entrada ou "Rodar fluxo"), o fluxo preferido do agente substitui o
   * da coluna quando existe no projeto. Fluxo escolhido à mão (`startById`) não muda.
   */
  private async start(
    projectId: string,
    taskId: string,
    stageId: string | null,
    columnFlowId: string,
    useAgentFlow: boolean
  ): Promise<FlowRunView> {
    if (this.activeRow(taskId)) throw new FlowError('busy', FLOW_MESSAGES.busy)
    const agent = (await this.deps.agentFor?.(projectId, taskId)) ?? null
    const flows = this.deps.flows(projectId).flows
    const preferred = useAgentFlow && agent?.profile.flow ? agent.profile.flow : null
    const flowId = preferred && flows.some((f) => f.id === preferred) ? preferred : columnFlowId
    const flow = flows.find((f) => f.id === flowId)
    if (!flow) throw new FlowError('flow_missing', FLOW_MESSAGES.flowMissing)
    if (agent) {
      const denied = checkAgentFlow(agent.profile, flow)
      if (denied) throw new FlowError('agent_denied', denied)
    }
    const blocked = await this.deps.canStart?.(projectId, flow)
    if (blocked) throw new FlowError('not_ready', blocked)
    const id = this.deps.newId?.() ?? randomUUID()
    const persisted: Persisted = {
      engine: { vars: {}, visits: {}, outcomes: {}, executed: 0 },
      displayId: '',
      notionUrl: null
    }
    const wait = this.slot(projectId, flow, agent)
    const waits = wait !== null
    this.deps.store.transaction(() => {
      this.deps.db.run(
        `INSERT INTO flow_runs (id, task_page_id, project_id, flow_id, flow_json, stage_id, status, pause_reason, state_json, started_at, agent_key, agent_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        taskId,
        projectId,
        flow.id,
        JSON.stringify(flow),
        stageId,
        waits ? 'paused' : 'running',
        wait,
        JSON.stringify(persisted),
        this.now(),
        agent?.key ?? null,
        agent ? JSON.stringify(agent) : null
      )
      this.event(this.row(id), 'flow_started', {
        flow: flow.name,
        ...(agent ? { agent: agent.profile.name, agentKey: agent.key } : {}),
        ...(waits ? { waiting: true } : {})
      })
    })
    this.deps.emit({ projectId, taskId })
    if (!waits) await this.withLock(id, () => this.begin(id))
    return this.view(id)
  }

  /** Primeiro passo (com as variáveis iniciais da integração). */
  private async begin(id: string): Promise<void> {
    const row = this.row(id)
    // Cancelado enquanto esperava a vaga.
    if (row.status !== 'running' && row.status !== 'paused') return
    const vars = await this.safeInitialVars(row)
    this.deps.db.run(
      `UPDATE flow_runs SET status = 'running', pause_reason = NULL WHERE id = ?`,
      id
    )
    await this.apply(id, startFlow(this.flow(row), vars))
  }

  private async safeInitialVars(row: RunRow): Promise<Record<string, string>> {
    try {
      return cleanVars(
        (await this.deps.initialVars?.(row.project_id, row.task_page_id, this.flow(row))) ?? {}
      )
    } catch (error) {
      console.error(`[orkio] fluxo (variáveis iniciais): ${errorName(error)}`)
      return {}
    }
  }

  /**
   * Cabe mais um fluxo? `null` = sim; senão o motivo da espera: limite do marcador no projeto
   * (`waiting_slot`, ex.: Alva com Docker) ou do agente em todas as tarefas (`waiting_agent`).
   */
  private slot(
    projectId: string,
    flow: Flow,
    agent: FlowAgent | null,
    self: string | null = null
  ): 'waiting_slot' | 'waiting_agent' | null {
    const active = this.deps.db
      .all<RunRow>(
        `SELECT * FROM flow_runs WHERE status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision') AND COALESCE(pause_reason, '') NOT IN ('waiting_slot', 'waiting_agent')`
      )
      .filter((r) => r.id !== self)
    const tag = flow.tags?.[0]
    const limit = tag ? (this.deps.concurrencyLimit?.(projectId, flow) ?? null) : null
    if (tag && limit !== null) {
      const busy = active.filter(
        (r) => r.project_id === projectId && this.flow(r).tags?.includes(tag)
      ).length
      if (busy >= limit) return 'waiting_slot'
    }
    if (agent) {
      const busy = active.filter((r) => r.agent_key === agent.key).length
      if (busy >= agent.profile.limits.parallel) return 'waiting_agent'
    }
    return null
  }

  /**
   * Um fluxo terminou: começa quem esperava vaga (do mais antigo ao mais novo) e já cabe. A vaga é
   * tomada na hora (status `running`) para dois fluxos não pegarem a mesma.
   */
  private promoteWaiting(): void {
    const waiting = this.deps.db.all<RunRow>(
      `SELECT * FROM flow_runs WHERE status = 'paused' AND pause_reason IN ('waiting_slot', 'waiting_agent') ORDER BY started_at`
    )
    for (const row of waiting) {
      if (this.slot(row.project_id, this.flow(row), this.agentOf(row), row.id) !== null) continue
      this.deps.db.run(
        `UPDATE flow_runs SET status = 'running', pause_reason = NULL WHERE id = ? AND status = 'paused'`,
        row.id
      )
      void this.withLock(row.id, () => this.begin(row.id)).catch((error: unknown) => {
        console.error(`[orkio] fluxo (vaga liberada): ${errorName(error)}`)
      })
    }
  }

  private agentOf(row: RunRow): FlowAgent | null {
    if (!row.agent_json) return null
    try {
      return JSON.parse(row.agent_json) as FlowAgent
    } catch {
      return null
    }
  }

  /** Você escolheu uma opção pedida por um extrator. */
  async choose(flowRunId: string, value: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      const p = this.persisted(row)
      const pc = p.pendingChoice
      if (row.status !== 'paused' || row.pause_reason !== 'needs_choice' || !pc) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      if (!pc.options.some((o) => o.value === value)) {
        throw new FlowError('invalid', 'Opção inválida. Atualize a tela.')
      }
      const ex = this.deps.extractors.find((e) => e.id === pc.extractor)
      const step = this.flow(row).steps.find((st) => st.id === pc.stepId)
      const ctx = this.extractContext(
        row,
        pc.stepId,
        step?.type === 'claude_command' ? step.command : ''
      )
      const r = ex?.resolveChoice ? await ex.resolveChoice({ ctx, value }) : {}
      this.savePersisted(flowRunId, { ...p, pendingChoice: null })
      this.event(row, 'step_finished', { step: pc.stepId, choice: value })
      if (r.fail) {
        await this.apply(
          flowRunId,
          afterStep(this.flow(row), p.engine, pc.stepId, { outcome: 'failed' })
        )
        return
      }
      await this.apply(
        flowRunId,
        afterStep(this.flow(row), p.engine, pc.stepId, {
          outcome: 'ok',
          vars: { ...pc.vars, ...cleanVars(r.vars ?? {}) }
        })
      )
    })
    return this.view(flowRunId)
  }

  // ---------- Ações do usuário ----------

  approveGate(flowRunId: string, input?: string[]): Promise<FlowRunView> {
    return this.gateAnswer(flowRunId, 'approved', input)
  }

  rejectGate(flowRunId: string): Promise<FlowRunView> {
    return this.gateAnswer(flowRunId, 'rejected')
  }

  private async gateAnswer(
    flowRunId: string,
    outcome: 'approved' | 'rejected',
    input?: string[]
  ): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'waiting_gate' || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      this.clearGateTimer(flowRunId)
      const p = this.persisted(row)
      const step = this.flow(row).steps.find((st) => st.id === row.current_step)
      const action =
        step?.type === 'orkio_action'
          ? this.deps.actions.find((a) => a.id === step.action)
          : undefined
      if (step?.type === 'orkio_action' && action && !action.pending) {
        // Ação com confirmação: aprovar executa agora; recusar encerra o fluxo (recusado).
        this.savePersisted(flowRunId, { ...p, pendingConfirm: null })
        this.event(row, outcome === 'approved' ? 'gate_approved' : 'gate_rejected', {
          step: row.current_step
        })
        if (outcome === 'rejected') {
          this.closeStep(flowRunId, 'rejected', null)
          this.finishRun(row, 'finished', 'rejected')
          return
        }
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'running' WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?)`,
          flowRunId
        )
        this.setStatus(flowRunId, 'running', null)
        await this.execAction(this.row(flowRunId), step, action, input)
        return
      }
      this.closeStep(flowRunId, outcome, null)
      this.event(row, outcome === 'approved' ? 'gate_approved' : 'gate_rejected', {
        step: row.current_step
      })
      if (step?.type === 'orkio_action') {
        // Ação pendente (feita à mão): aprovar segue; recusar cancela o fluxo.
        if (outcome === 'rejected') {
          this.finishRun(row, 'cancelled', 'cancelled')
          return
        }
        await this.apply(
          flowRunId,
          afterStep(this.flow(row), p.engine, row.current_step, { outcome: 'ok' })
        )
        return
      }
      await this.apply(
        flowRunId,
        afterStep(this.flow(row), p.engine, row.current_step, { outcome })
      )
    })
    return this.view(flowRunId)
  }

  /** Retomar deste passo (pausa por falha, interrupção, limite ou gate expirado). */
  async resume(flowRunId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'paused' || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      const p = this.persisted(row)
      // Limite de passos: retomar ainda conta, mas o usuário decidiu seguir (zera a trava).
      const engine = row.pause_reason === 'loop_guard' ? { ...p.engine, executed: 0 } : p.engine
      // Limite do dia do agente: você decidiu seguir; vale para o próximo comando.
      if (row.pause_reason === 'agent_daily_limit') {
        this.savePersisted(flowRunId, { ...p, limitBypass: true })
      }
      await this.apply(flowRunId, retryStep(this.flow(row), engine, row.current_step))
    })
    return this.view(flowRunId)
  }

  /**
   * "Rodar de novo o passo anterior": volta a um comando do Claude Code que vem antes do passo
   * parado (ex.: o /commit antes de um push recusado) e segue o fluxo dali. Só em falha ou
   * interrupção; o histórico do passo que falhou fica como está.
   */
  async rerunFrom(flowRunId: string, stepId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (
        row.status !== 'paused' ||
        !row.current_step ||
        (row.pause_reason !== 'step_failed' && row.pause_reason !== 'interrupted')
      ) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      const flow = this.flow(row)
      const to = flow.steps.findIndex((s) => s.id === stepId)
      const from = flow.steps.findIndex((s) => s.id === row.current_step)
      if (to < 0 || from < 0 || to >= from || flow.steps[to]?.type !== 'claude_command') {
        throw new FlowError('invalid_step', FLOW_MESSAGES.invalidStep)
      }
      await this.apply(flowRunId, retryStep(flow, this.persisted(row).engine, stepId))
    })
    return this.view(flowRunId)
  }

  async skip(flowRunId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'paused' || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      this.deps.db.run(
        `UPDATE flow_steps SET status = 'skipped' WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?) AND status IN ('failed', 'interrupted', 'cancelled')`,
        flowRunId
      )
      this.event(row, 'step_skipped', { step: row.current_step })
      const as = row.pause_reason === 'interrupted' ? 'cancelled' : 'failed'
      const p = this.persisted(row)
      await this.apply(flowRunId, skipStep(this.flow(row), p.engine, row.current_step, as))
    })
    return this.view(flowRunId)
  }

  async cancel(flowRunId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (!ACTIVE.includes(row.status)) throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      this.clearGateTimer(flowRunId)
      const running = this.deps.db.get<StepRow>(
        `SELECT * FROM flow_steps WHERE flow_run_id = ? AND status IN ('running', 'waiting') ORDER BY id DESC LIMIT 1`,
        flowRunId
      )
      if (running?.run_id) this.deps.cancelClaude(running.run_id)
      if (running) this.closeStep(flowRunId, 'cancelled', 'Fluxo cancelado.')
      this.finishRun(row, 'cancelled', 'cancelled')
    })
    return this.view(flowRunId)
  }

  /** A tarefa saiu da etapa: "Cancelar fluxo" ou "Deixar terminar". */
  async decideLeft(flowRunId: string, choice: 'cancel' | 'continue'): Promise<FlowRunView> {
    if (choice === 'cancel') {
      const row = this.row(flowRunId)
      if (row.status !== 'awaiting_decision') {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      return this.cancel(flowRunId)
    }
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'awaiting_decision') {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      // Deixa de acompanhar a etapa: a partir daqui o fluxo segue até o fim.
      this.deps.db.run(`UPDATE flow_runs SET stage_id = NULL WHERE id = ?`, flowRunId)
      const p = this.persisted(row)
      const step = this.deps.db.get<StepRow>(
        `SELECT * FROM flow_steps WHERE flow_run_id = ? ORDER BY id DESC LIMIT 1`,
        flowRunId
      )
      if (p.pendingEnd) {
        this.savePersisted(flowRunId, { ...p, pendingEnd: null })
        await this.apply(
          flowRunId,
          afterStep(this.flow(row), p.engine, p.pendingEnd.stepId, p.pendingEnd.end)
        )
      } else if (step?.status === 'running') {
        // O passo ainda roda: volta a "rodando" e o fim dele segue normalmente.
        this.setStatus(flowRunId, 'running', null)
      } else if (step?.status === 'waiting') {
        this.setStatus(flowRunId, 'waiting_gate', null)
        this.armGateTimer(this.row(flowRunId))
      } else if (step?.status === 'interrupted') {
        this.setStatus(flowRunId, 'paused', 'interrupted')
      } else {
        this.setStatus(flowRunId, 'paused', 'step_failed')
      }
    })
    return this.view(flowRunId)
  }

  // ---------- Fim das execuções da 4A ----------

  onRunFinished(finished: RunFinished): void {
    let info = finished
    if (this.disposed) return
    const ref = this.runIndex.get(info.runId)
    if (!ref) return
    this.runIndex.delete(info.runId)
    void this.withLock(ref.flowRunId, async () => {
      const row = this.row(ref.flowRunId)
      const current = this.deps.db.get<StepRow>('SELECT * FROM flow_steps WHERE id = ?', ref.rowId)
      if (!current || current.status !== 'running') return
      const step = this.flow(row).steps.find((s) => s.id === current.step_id)
      let end: StepEnd
      let extracted: ExtractResult = {}
      if (info.status === 'succeeded' && step?.type === 'claude_command' && step.extract) {
        extracted = await this.extract(
          row,
          step.extract.extractor,
          step.id,
          step.command,
          info.resultText,
          info.runId
        )
      }
      if (info.status === 'succeeded' && extracted.fail) {
        end = { outcome: 'failed' }
        info = { ...info, message: extracted.fail }
      } else if (info.status === 'succeeded') {
        end = { outcome: 'ok', vars: cleanVars(extracted.vars ?? {}) }
      } else {
        end = { outcome: info.status === 'cancelled' ? 'cancelled' : 'failed' }
      }
      this.closeStep(
        ref.flowRunId,
        end.outcome === 'ok' ? 'ok' : end.outcome === 'cancelled' ? 'cancelled' : 'failed',
        info.message,
        { costUsd: info.costUsd }
      )
      this.event(row, end.outcome === 'ok' ? 'step_finished' : 'step_failed', {
        step: current.step_id,
        runId: info.runId,
        ...(info.message ? { message: info.message } : {})
      })
      if (extracted.choose && end.outcome === 'ok' && row.status === 'running') {
        const p = this.persisted(row)
        this.savePersisted(ref.flowRunId, {
          ...p,
          pendingChoice: {
            stepId: current.step_id,
            extractor: step?.type === 'claude_command' ? (step.extract?.extractor ?? '') : '',
            prompt: extracted.choose.prompt,
            options: extracted.choose.options.slice(0, 20),
            vars: end.vars ?? {}
          }
        })
        this.deps.db.run(
          `UPDATE flow_runs SET status = 'paused', pause_reason = 'needs_choice' WHERE id = ?`,
          ref.flowRunId
        )
        this.event(row, 'flow_paused', { reason: 'needs_choice', step: current.step_id })
        this.notifyRow(row, 'Um fluxo precisa de você', extracted.choose.prompt)
        this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
        return
      }
      if (row.status === 'awaiting_decision') {
        // Você ainda não decidiu: guarda o fim e espera.
        this.savePersisted(ref.flowRunId, {
          ...this.persisted(row),
          pendingEnd: { stepId: current.step_id, end }
        })
        this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
        return
      }
      if (row.status !== 'running') return
      await this.apply(
        ref.flowRunId,
        afterStep(this.flow(row), this.persisted(row).engine, current.step_id, end)
      )
    }).catch((error: unknown) => {
      console.error(`[orkio] fluxo (fim de execução): ${errorName(error)}`)
    })
  }

  // ---------- Leitura ----------

  /** Fluxo ativo ou o mais recente da tarefa, e os anteriores. */
  list(taskId: string): FlowRunView[] {
    return this.deps.db
      .all<{ id: string }>(
        'SELECT id FROM flow_runs WHERE task_page_id = ? ORDER BY started_at DESC LIMIT 10',
        taskId
      )
      .map((r) => this.view(r.id))
  }

  /** Para o card do quadro: tarefas com fluxo ativo e se ele espera você. */
  activeForProject(projectId: string): Record<string, 'running' | 'needs_you'> {
    const out: Record<string, 'running' | 'needs_you'> = {}
    for (const r of this.deps.db.all<{ task_page_id: string; status: FlowRunStatus }>(
      `SELECT task_page_id, status FROM flow_runs WHERE project_id = ? AND status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision')`,
      projectId
    )) {
      out[r.task_page_id] = needsYou(r.status) ? 'needs_you' : 'running'
    }
    return out
  }

  /**
   * Fluxos com passo rodando ou entre passos (6C: a atualização espera por eles). Gate, pausa e
   * decisão pendente não contam: sobrevivem a reabrir o app.
   */
  runningList(): { projectId: string; taskId: string; flowName: string; step: string | null }[] {
    return this.deps.db
      .all<RunRow>(`SELECT * FROM flow_runs WHERE status = 'running' ORDER BY started_at`)
      .map((r) => {
        let flowName = 'Fluxo'
        let step: string | null = null
        try {
          const flow = JSON.parse(r.flow_json) as Flow
          flowName = flow.name || flowName
          const current = flow.steps.find((s) => s.id === r.current_step)
          step = current ? current.name || current.id : null
        } catch {
          // cópia ilegível: só o nome genérico
        }
        return { projectId: r.project_id, taskId: r.task_page_id, flowName, step }
      })
  }

  /** Fluxos ativos de todos os projetos (Visão geral, 6D). */
  activeViews(): FlowRunView[] {
    return this.deps.db
      .all<{ id: string }>(
        `SELECT id FROM flow_runs WHERE status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision') ORDER BY started_at`
      )
      .map((r) => this.view(r.id))
  }

  /** Há fluxo ativo na tarefa? (a execução manual do Claude Code fica bloqueada). */
  hasActive(taskId: string): boolean {
    return this.activeRow(taskId) !== null
  }

  /**
   * O fluxo da tarefa está rodando um passo (ou vai começar um sozinho: fila de vaga/agente)?
   * Esperando você (gate, escolha, pausa por falha, saída da etapa) não conta.
   */
  isBusy(taskId: string): boolean {
    const row = this.activeRow(taskId)
    if (!row) return false
    return (
      row.status === 'running' ||
      (row.status === 'paused' &&
        (row.pause_reason === 'waiting_slot' || row.pause_reason === 'waiting_agent'))
    )
  }

  view(flowRunId: string): FlowRunView {
    const row = this.row(flowRunId)
    const flow = this.flow(row)
    const history = this.deps.db
      .all<StepRow>('SELECT * FROM flow_steps WHERE flow_run_id = ? ORDER BY id', flowRunId)
      .map((s, i): FlowStepView => {
        const r = s.result_json
          ? (JSON.parse(s.result_json) as { message?: string; costUsd?: number | null })
          : {}
        return {
          seq: i + 1,
          stepId: s.step_id,
          runId: s.run_id,
          status: s.status,
          startedAt: s.started_at,
          endedAt: s.ended_at,
          message: r.message ?? null,
          costUsd: r.costUsd ?? null
        }
      })
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_page_id,
      flowId: row.flow_id,
      flowName: flow.name,
      steps: flow.steps,
      status: row.status,
      currentStep: row.current_step,
      pauseReason: row.pause_reason,
      result: row.result,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      vars: this.persisted(row).engine.vars,
      history,
      choice: this.persisted(row).pendingChoice
        ? {
            prompt: this.persisted(row).pendingChoice!.prompt,
            options: this.persisted(row).pendingChoice!.options
          }
        : null,
      confirm: row.status === 'waiting_gate' ? (this.persisted(row).pendingConfirm ?? null) : null,
      agent: (() => {
        const a = this.agentOf(row)
        return a ? { key: a.key, name: a.profile.name, color: a.profile.color } : null
      })()
    }
  }

  // ---------- Interno ----------

  private async apply(flowRunId: string, decision: FlowDecision): Promise<void> {
    const row = this.row(flowRunId)
    const p = this.persisted(row)
    this.savePersisted(flowRunId, { ...p, engine: decision.state })
    if (decision.kind === 'finished') {
      this.finishRun(row, 'finished', decision.result)
      return
    }
    if (decision.kind === 'paused') {
      this.deps.db.run(
        `UPDATE flow_runs SET status = 'paused', pause_reason = ?, current_step = COALESCE(?, current_step) WHERE id = ?`,
        decision.reason,
        decision.stepId,
        flowRunId
      )
      this.event(row, 'flow_paused', { reason: decision.reason, step: decision.stepId })
      this.notifyRow(row, 'Um fluxo precisa de você', this.pauseText(decision.reason, row))
      this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
      return
    }
    if (this.agentLimitReached(flowRunId, decision.stepId)) return
    await this.runStep(this.row(flowRunId), decision.stepId)
  }

  /**
   * 8A: antes de cada comando do Claude Code, o limite diário do agente (aplicado aqui, no main).
   * Atingido → o fluxo pausa no passo (sem rodar); "Retomar" passa por cima uma vez.
   */
  private agentLimitReached(flowRunId: string, stepId: string): boolean {
    const row = this.row(flowRunId)
    const agent = this.agentOf(row)
    const step = this.flow(row).steps.find((s) => s.id === stepId)
    if (!agent || step?.type !== 'claude_command' || !this.deps.agentLimit) return false
    const p = this.persisted(row)
    if (p.limitBypass) {
      this.savePersisted(flowRunId, { ...p, limitBypass: false })
      return false
    }
    const problem = this.deps.agentLimit(agent)
    if (!problem) return false
    this.deps.db.run(
      `UPDATE flow_runs SET status = 'paused', pause_reason = 'agent_daily_limit', current_step = ? WHERE id = ?`,
      stepId,
      flowRunId
    )
    this.event(row, 'flow_paused', { reason: 'agent_daily_limit', step: stepId })
    this.notifyRow(row, 'Um fluxo precisa de você', problem)
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
    return true
  }

  private async runStep(row: RunRow, stepId: string): Promise<void> {
    const step = this.flow(row).steps.find((s) => s.id === stepId)!
    this.deps.db.run(
      `UPDATE flow_runs SET status = 'running', pause_reason = NULL, current_step = ? WHERE id = ?`,
      stepId,
      row.id
    )
    const at = this.now()
    const rowId = this.deps.db.run(
      `INSERT INTO flow_steps (flow_run_id, step_id, status, started_at) VALUES (?, ?, ?, ?)`,
      row.id,
      stepId,
      step.type === 'gate' ? 'waiting' : 'running',
      at
    ).lastInsertRowid
    this.event(row, step.type === 'gate' ? 'gate_waiting' : 'step_started', { step: stepId })
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })

    switch (step.type) {
      case 'gate':
        this.setStatus(row.id, 'waiting_gate', null)
        this.notifyRow(row, 'Um fluxo espera sua aprovação', step.message)
        this.armGateTimer(this.row(row.id))
        return
      case 'claude_command':
        await this.runClaude(row, step, Number(rowId))
        return
      case 'orkio_action':
        await this.runAction(row, step)
        return
      case 'branch':
        // O motor resolve saltos sozinho; não chega aqui.
        return
    }
  }

  private async runClaude(
    row: RunRow,
    step: Extract<Step, { type: 'claude_command' }>,
    rowId: number
  ): Promise<void> {
    try {
      const ctx = await this.context(row)
      // Extrator com "antes": tira a foto antes do comando rodar.
      const ex = step.extract
        ? this.deps.extractors.find((e) => e.id === step.extract!.extractor)
        : undefined
      const snap = ex?.snapshot
        ? await ex.snapshot(this.extractContext(row, step.id, step.command)).catch(() => undefined)
        : undefined
      const { text, missing } = renderArgs(step.args, {
        briefingPath: '.orkio/briefing.md',
        taskId: ctx.displayId,
        ...(ctx.title ? { taskTitle: ctx.title } : {}),
        notionUrl: ctx.notionUrl,
        vars: this.persisted(this.row(row.id)).engine.vars
      })
      // Variável do alva-flow sem valor (a task do Backlog não foi vinculada): o comando rodaria com
      // o argumento vazio e gastaria uma execução à toa. Para antes de começar.
      if (missing.some((name) => name.startsWith('alva.'))) {
        throw new FlowError('missing_vars', FLOW_MESSAGES.noBacklogTask)
      }
      const runId = await this.deps.startClaude({
        projectId: row.project_id,
        taskId: row.task_page_id,
        command: step.command,
        args: text,
        briefing: ctx.briefing,
        timeoutMin: step.timeoutMin,
        includeBriefing: step.includeBriefing !== false,
        delivery: step.delivery === true,
        agent: this.runAgent(row)
      })
      this.deps.db.run('UPDATE flow_steps SET run_id = ? WHERE id = ?', runId, rowId)
      this.runIndex.set(runId, { flowRunId: row.id, rowId })
      if (snap !== undefined) this.snapshots.set(runId, snap)
      this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
    } catch (error) {
      // Não iniciou (Claude Code ausente, worktree...): falha, o fluxo pausa.
      const message =
        error instanceof FlowError ? error.message : 'Não foi possível iniciar o Claude Code.'
      if (!(error instanceof FlowError)) {
        console.error(`[orkio] fluxo (iniciar comando): ${errorName(error)}`)
      }
      this.closeStep(row.id, 'failed', message)
      this.event(row, 'step_failed', { step: step.id, message })
      await this.apply(
        row.id,
        afterStep(this.flow(row), this.persisted(this.row(row.id)).engine, step.id, {
          outcome: 'failed'
        })
      )
    }
  }

  private async runAction(
    row: RunRow,
    step: Extract<Step, { type: 'orkio_action' }>
  ): Promise<void> {
    const action = this.deps.actions.find((a) => a.id === step.action)
    if (action?.pending) {
      // Ainda não existe (ex.: push antes da 5C): espera você fazer à mão e aprovar.
      this.deps.db.run(
        `UPDATE flow_steps SET status = 'waiting' WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?)`,
        row.id
      )
      this.setStatus(row.id, 'waiting_gate', null)
      this.notifyRow(row, 'Um fluxo espera você', action.pending)
      return
    }
    if (!action) {
      await this.endAction(row, step, { outcome: 'failed' }, `Ação desconhecida: ${step.action}`)
      return
    }
    if (action.confirm) {
      let info: ActionConfirm | { problem: string } | null
      try {
        info = await action.confirm({
          projectId: row.project_id,
          taskId: row.task_page_id,
          vars: this.persisted(this.row(row.id)).engine.vars
        })
      } catch (error) {
        console.error(`[orkio] ação do fluxo (confirmar): ${errorName(error)}`)
        info = { problem: 'Não foi possível preparar a ação do Orkio.' }
      }
      if (info && 'problem' in info) {
        await this.endAction(row, step, { outcome: 'failed' }, info.problem)
        return
      }
      if (info) {
        // Gate da ação: espera você aprovar (com o que vai acontecer na tela).
        this.savePersisted(row.id, { ...this.persisted(this.row(row.id)), pendingConfirm: info })
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'waiting' WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?)`,
          row.id
        )
        this.event(row, 'gate_waiting', { step: step.id })
        this.setStatus(row.id, 'waiting_gate', null)
        this.notifyRow(row, 'Um fluxo espera sua aprovação', info.title)
        return
      }
    }
    await this.execAction(row, step, action)
  }

  private async execAction(
    row: RunRow,
    step: Extract<Step, { type: 'orkio_action' }>,
    action: OrkioAction,
    input?: string[]
  ): Promise<void> {
    const engine = this.persisted(this.row(row.id)).engine
    let end: StepEnd
    let message: string | null = null
    try {
      const r = await action.run({
        projectId: row.project_id,
        taskId: row.task_page_id,
        vars: engine.vars,
        ...(input ? { input } : {})
      })
      if (r.ok) end = { outcome: 'ok', ...(r.vars ? { vars: cleanVars(r.vars) } : {}) }
      else {
        end = { outcome: 'failed' }
        message = r.message
      }
    } catch (error) {
      console.error(`[orkio] ação do fluxo: ${errorName(error)}`)
      end = { outcome: 'failed' }
      message = 'A ação do Orkio falhou.'
    }
    await this.endAction(row, step, end, message)
  }

  private async endAction(
    row: RunRow,
    step: Extract<Step, { type: 'orkio_action' }>,
    end: StepEnd,
    message: string | null
  ): Promise<void> {
    const engine = this.persisted(this.row(row.id)).engine
    this.closeStep(row.id, end.outcome === 'ok' ? 'ok' : 'failed', message)
    this.event(row, end.outcome === 'ok' ? 'step_finished' : 'step_failed', {
      step: step.id,
      ...(message ? { message } : {})
    })
    await this.apply(row.id, afterStep(this.flow(row), engine, step.id, end))
  }

  private async leftStage(flowRunId: string): Promise<void> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (!ACTIVE.includes(row.status) || row.status === 'awaiting_decision') return
      this.clearGateTimer(flowRunId)
      this.setStatus(flowRunId, 'awaiting_decision', 'left_stage')
      this.event(row, 'flow_paused', { reason: 'left_stage', step: row.current_step })
      this.notifyRow(
        row,
        'A tarefa saiu da etapa do fluxo',
        'Escolha no Orkio: cancelar o fluxo ou deixar terminar.'
      )
    })
  }

  private finishRun(row: RunRow, status: 'finished' | 'cancelled', result: RunRow['result']): void {
    this.deps.db.run(
      `UPDATE flow_runs SET status = ?, result = ?, pause_reason = NULL, ended_at = ? WHERE id = ?`,
      status,
      result,
      this.now(),
      row.id
    )
    this.event(row, 'flow_finished', { result })
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
    this.briefings.delete(row.id)
    this.promoteWaiting()
    this.deps.onFinished?.({ projectId: row.project_id, taskId: row.task_page_id, result })
  }

  private closeStep(
    flowRunId: string,
    status: FlowStepStatus,
    message: string | null,
    extra: { costUsd?: number | null } = {}
  ): void {
    const result = { ...(message ? { message } : {}), ...extra }
    this.deps.db.run(
      `UPDATE flow_steps SET status = ?, ended_at = ?, result_json = ? WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?)`,
      status,
      this.now(),
      Object.keys(result).length > 0 ? JSON.stringify(result) : null,
      flowRunId
    )
  }

  private setStatus(
    flowRunId: string,
    status: FlowRunStatus,
    reason: FlowPauseReason | null
  ): void {
    this.deps.db.run(
      'UPDATE flow_runs SET status = ?, pause_reason = ? WHERE id = ?',
      status,
      reason,
      flowRunId
    )
    const row = this.row(flowRunId)
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
  }

  private armGateTimer(row: RunRow): void {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    if (step?.type !== 'gate' || step.timeoutMin === null) return
    const started = this.deps.db.get<StepRow>(
      `SELECT * FROM flow_steps WHERE flow_run_id = ? AND status = 'waiting' ORDER BY id DESC LIMIT 1`,
      row.id
    )
    const since = started ? Date.parse(started.started_at) : Date.now()
    const left = Math.max(0, since + step.timeoutMin * 60_000 - Date.now())
    this.clearGateTimer(row.id)
    this.gateTimers.set(
      row.id,
      setTimeout(() => {
        void this.withLock(row.id, async () => {
          const r = this.row(row.id)
          if (r.status !== 'waiting_gate') return
          this.closeStep(row.id, 'cancelled', 'A aprovação expirou.')
          this.deps.db.run(
            `UPDATE flow_runs SET status = 'paused', pause_reason = 'gate_timeout' WHERE id = ?`,
            row.id
          )
          this.event(r, 'flow_paused', { reason: 'gate_timeout', step: r.current_step })
          this.notifyRow(r, 'Um fluxo precisa de você', FLOW_PAUSE_TEXT.gate_timeout)
          this.deps.emit({ projectId: r.project_id, taskId: r.task_page_id })
        })
      }, left)
    )
  }

  private clearGateTimer(flowRunId: string): void {
    const t = this.gateTimers.get(flowRunId)
    if (t) clearTimeout(t)
    this.gateTimers.delete(flowRunId)
  }

  private async context(row: RunRow): Promise<FlowContext> {
    const cached = this.briefings.get(row.id)
    const p = this.persisted(row)
    if (cached !== undefined && p.displayId) {
      return {
        briefing: cached.briefing,
        displayId: p.displayId,
        notionUrl: p.notionUrl,
        ...(cached.title ? { title: cached.title } : {})
      }
    }
    const ctx = await this.deps.prepare(row.project_id, row.task_page_id)
    this.briefings.set(row.id, {
      briefing: ctx.briefing,
      ...(ctx.title ? { title: ctx.title } : {})
    })
    this.savePersisted(row.id, { ...p, displayId: ctx.displayId, notionUrl: ctx.notionUrl })
    return ctx
  }

  private async extract(
    row: RunRow,
    extractorId: string,
    stepId: string,
    command: string,
    resultText: string,
    runId: string
  ): Promise<ExtractResult> {
    const ex = this.deps.extractors.find((e) => e.id === extractorId)
    const snapshot = this.snapshots.get(runId)
    this.snapshots.delete(runId)
    if (!ex) return {}
    try {
      return await ex.extract({
        resultText,
        ctx: this.extractContext(row, stepId, command),
        snapshot
      })
    } catch (error) {
      console.error(`[orkio] extrator ${extractorId}: ${errorName(error)}`)
      return {}
    }
  }

  private runAgent(row: RunRow): RunAgent | null {
    const a = this.agentOf(row)
    if (!a) return null
    return {
      key: a.key,
      name: a.profile.name,
      prompt: buildAgentPrompt(a.profile),
      model: a.profile.model === 'default' ? null : a.profile.model
    }
  }

  private extractContext(row: RunRow, stepId: string, command: string): ExtractContext {
    return {
      projectId: row.project_id,
      taskId: row.task_page_id,
      stepId,
      command,
      worktreePath: this.deps.worktreePath?.(row.task_page_id) ?? null
    }
  }

  private pauseText(reason: FlowPauseReason, row: RunRow): string {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    return `${FLOW_PAUSE_TEXT[reason]}${step ? ` (${step.name})` : ''}`
  }

  private notifyRow(row: RunRow, title: string, body: string): void {
    this.deps.notify(title, body, { projectId: row.project_id, taskId: row.task_page_id })
  }

  private event(row: RunRow, kind: TaskEventKind, detail: Record<string, unknown>): void {
    this.deps.store.addEvent({
      taskPageId: row.task_page_id,
      projectId: row.project_id,
      at: this.now(),
      kind,
      source: 'manual',
      fromStage: null,
      toStage: null,
      detail: { flowRunId: row.id, ...detail }
    })
  }

  private activeRow(taskId: string): RunRow | null {
    return (
      this.deps.db.get<RunRow>(
        `SELECT * FROM flow_runs WHERE task_page_id = ? AND status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision') ORDER BY started_at DESC LIMIT 1`,
        taskId
      ) ?? null
    )
  }

  private row(id: string): RunRow {
    const row = this.deps.db.get<RunRow>('SELECT * FROM flow_runs WHERE id = ?', id)
    if (!row) throw new FlowError('not_found', FLOW_MESSAGES.notFound)
    return row
  }

  private flow(row: RunRow): Flow {
    return JSON.parse(row.flow_json) as Flow
  }

  private persisted(row: RunRow): Persisted {
    return JSON.parse(row.state_json) as Persisted
  }

  private savePersisted(id: string, p: Persisted): void {
    this.deps.db.run('UPDATE flow_runs SET state_json = ? WHERE id = ?', JSON.stringify(p), id)
  }

  /** Operações do mesmo fluxo em fila (fim de execução × clique do usuário). */
  private withLock(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    const tail = next.catch(() => undefined)
    this.locks.set(id, tail)
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id)
    })
    return next
  }
}

const FLOW_PAUSE_TEXT: Record<FlowPauseReason, string> = {
  step_failed: 'Um passo falhou. Retome, pule ou cancele o fluxo.',
  interrupted: 'O Orkio foi fechado no meio do passo. Retome, pule ou cancele.',
  loop_guard: 'O fluxo atingiu o limite de passos. Confira se não está em loop.',
  gate_timeout: 'A aprovação expirou. Retome para pedir de novo, pule ou cancele.',
  left_stage: 'A tarefa saiu da etapa do fluxo.',
  needs_choice: 'Escolha uma opção no Orkio para o fluxo seguir.',
  waiting_slot: 'Aguardando outro fluxo do projeto terminar.',
  waiting_agent: 'Aguardando o agente terminar outra tarefa.',
  agent_daily_limit: 'O agente atingiu o limite de hoje. Retome para passar por cima uma vez.'
}

/** Extrator de exemplo: linhas `@orkio chave=valor` no texto final do Claude Code. */
export const ORKIO_LINES_EXTRACTOR: FlowExtractor = {
  id: 'linhas_orkio',
  label: 'Linhas “@orkio chave=valor” no resultado',
  extract({ resultText }) {
    const vars: Record<string, string> = {}
    for (const m of resultText.matchAll(/^\s*@orkio\s+([a-z][a-z0-9_]{0,39})\s*=\s*(.*)$/gm)) {
      vars[m[1]!] = m[2]!.trim()
    }
    return { vars }
  }
}

/** Ação de teste (5C traz push e pedir review). */
export const NOOP_ACTION: OrkioAction = {
  id: 'noop',
  label: 'Nada (teste)',
  run: async () => ({ ok: true })
}

/** Variáveis do fluxo: chaves válidas, valores curtos e sem segredos. */
export function cleanVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars).slice(0, 30)) {
    if (VAR_KEY.test(k)) out[k] = redactSecrets(String(v)).slice(0, 500)
  }
  return out
}

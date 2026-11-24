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
  gateRevisions,
  isPromptStep,
  MAX_PROMPT_CHARS,
  renderArgs,
  renderMessage,
  retryStep,
  reviseGate,
  skipStep,
  startFlow,
  VAR_KEY,
  type Flow,
  type ActionConfirm,
  type ClaudeCommandStep,
  type FlowDecision,
  type FlowPauseReason,
  type FlowRunStatus,
  type FlowRunView,
  type FlowState,
  type FlowStepStatus,
  type FlowStepView,
  type ProjectFlows,
  type Step,
  type StepEnd,
  type StepFailure,
  type TaskFlowActivity
} from '../../shared/task-flow'
import {
  acceptsReply,
  ACTIVE_FLOW_STATUSES,
  FLOW_PAUSE_REASONS,
  FLOW_PAUSES,
  needsYou,
  waitingKind
} from '../../shared/flow-run-state'
import {
  ORKIO_ACTIONS,
  type OrkioActionDescriptor,
  type StageMoveBehavior
} from '../../shared/orkio-actions'
import { integrationsOf, type FlowIntegration } from './flow-integration'
import type { BoardStore, TaskEventInput } from '../board/board.store'
import type { TaskEventDetailInput } from '../../shared/task-events'
import type { StageChange } from '../board/board.service'
import { isStageEntry } from '../board/stage-entry'
import type { RunFinished } from '../claude/run.service'
import { BRIEFING_PATH } from '../../shared/orkio-scratch'
import { redactSecrets } from '../platform/redact'
import { toRunAgent, type RunAgent, type RunRequest } from '../claude/run-spec'
import { checkAgentFlow, type AgentProfile } from '../../shared/agent'
import type { Db } from '../db/database'
import { DomainError, errorName } from '../errors'

/** Eventos do histórico gravados pelo fluxo (todos levam o `flowRunId`). */
type FlowEventKind =
  | 'flow_started'
  | 'step_started'
  | 'step_finished'
  | 'step_failed'
  | 'step_skipped'
  | 'gate_waiting'
  | 'gate_approved'
  | 'gate_rejected'
  | 'gate_revised'
  | 'flow_paused'
  | 'flow_finished'
export const FLOW_MESSAGES = {
  noBinding: 'A etapa atual da tarefa não tem fluxo ligado (ou ele está desligado).',
  busy: 'Esta tarefa já tem um fluxo em andamento. Termine ou cancele antes de começar outro.',
  notFound: 'Fluxo não encontrado. Atualize a tela.',
  wrongState: 'O fluxo não está esperando essa ação. Atualize a tela.',
  flowMissing: 'O fluxo ligado a esta etapa não existe mais. Revise o Fluxo do projeto.',
  invalidStep: 'Esse passo não pode ser rodado de novo agora. Atualize a tela.',
  emptyReply: 'Escreva a resposta para o Claude.',
  choiceUnclear:
    'O fluxo está esperando você escolher uma opção. Diga qual (ex.: TASK-5) ou escolha no cartão.',
  emptyRevise: 'Escreva o que ajustar.',
  longRevise: `O pedido de ajuste passa de ${MAX_PROMPT_CHARS} caracteres. Encurte e tente de novo.`,
  notRevisable: 'Este gate não aceita pedidos de ajuste. Aprove ou recuse.',
  reviseLimit: (max: number): string =>
    `Limite de ajustes atingido (${max}). Aprove ou recuse no cartão.`
} as const

export class FlowError extends DomainError {
  override name = 'FlowError'
}

/** Contexto de um passo para extratores (sem segredos; o worktree é local). */
export interface ExtractContext {
  projectId: string
  taskId: string
  step: ClaudeCommandStep
  worktreePath: string | null
}

export interface ExtractResult {
  vars?: Record<string, string>
  /** O passo conta como falho, com este código e mensagem (o fluxo pausa). */
  fail?: StepFailure
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
  /** Execução do Claude Code mais recente deste fluxo (ex.: a revisão em JSON a publicar). */
  lastRunId?: string | null
}

/** Resultado de uma ação: variáveis (só as declaradas em `outputs`) ou a falha do passo. */
export type ActionResult =
  { ok: true; vars?: Record<string, string> } | ({ ok: false } & StepFailure)

/**
 * Ação do próprio Orkio: o descritor de `shared/orkio-actions.ts` (o que ela é) + o comportamento.
 */
export interface OrkioAction extends OrkioActionDescriptor {
  /**
   * Antes de agir: o que mostrar para você aprovar (gate da ação), `{ problem }` para falhar já
   * (o fluxo pausa) ou `null` para agir sem perguntar. Recusar encerra o fluxo como recusado.
   */
  confirm?(ctx: ActionContext): Promise<ActionConfirm | { problem: StepFailure } | null>
  run(
    ctx: ActionContext & {
      input?: string[]
      /** O que você aprovou no gate da ação (`confirm`), exatamente como foi mostrado. */
      confirmed?: ActionConfirm
    }
  ): Promise<ActionResult>
}

/** Códigos de falha do próprio executor (as ações e o Claude Code trazem os deles). */
export const FLOW_FAILURES = {
  unknownAction: 'unknown_action',
  actionFailed: 'action_failed',
  startFailed: 'start_failed'
} as const

export interface FlowContext {
  briefing: string
  displayId: string
  title?: string
  notionUrl: string | null
}

export interface FlowRunnerDeps {
  db: Db
  store: BoardStore
  flows(projectId: string): ProjectFlows
  currentStage(projectId: string, taskId: string): string | null
  /** Monta o briefing da tarefa (Notion) e garante o worktree. */
  prepare(projectId: string, taskId: string): Promise<FlowContext>
  /**
   * Inicia uma execução da 4A (o mesmo pedido do campo da sessão e do "Rodar"); devolve o id.
   * Falha esperada: lance `FlowError` (mensagem pt-BR).
   */
  startClaude(request: RunRequest): Promise<string>
  cancelClaude(runId: string): void
  extractors: readonly FlowExtractor[]
  actions: readonly OrkioAction[]
  worktreePath(taskId: string): string | null
  integrations: readonly FlowIntegration[]
  /**
   * 8A: agente atribuído à tarefa (`null` = nenhum). Lança `FlowError` (mensagem pt-BR) quando há
   * agente, mas ele não pode rodar (sem aprovação, arquivado, apagado).
   */
  agentFor(projectId: string, taskId: string): Promise<FlowAgent | null>
  /** 8A: limite diário do agente atingido? Mensagem pt-BR ou `null`. */
  agentLimit(agent: FlowAgent): string | null
  notify(title: string, body: string, ref: { projectId: string; taskId: string }): void
  /** Algo mudou no fluxo da tarefa (a tela recarrega). */
  emit(ref: { projectId: string; taskId: string }): void
  /** 8B: um fluxo terminou (o orquestrador decide se a tarefa segue). */
  onFinished(ref: { projectId: string; taskId: string; result: RunRow['result'] }): void
  /**
   * A entrada numa etapa (`createEnterStage`: orquestrador, regra da coluna, fluxo da coluna), a
   * mesma que o quadro chama. Usada quando um fluxo que uma ação `detach_and_reenter` tirou da
   * etapa (ex.: a revisão publicada moveu a tarefa) termina: sem isso, o fluxo da coluna nova nunca
   * começaria, porque ela foi alcançada com outro fluxo ainda ativo.
   */
  enterStage(change: StageChange): void
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
  /**
   * Ação do Orkio esperando sua confirmação: metadados do git/GitHub e, no `publish_review`, o texto
   * da revisão (já limpo e redigido). Apagado ao aprovar, recusar e no fim do fluxo.
   */
  pendingConfirm?: ActionConfirm | null
  /** 8A: você retomou depois do limite diário do agente; vale para o próximo comando. */
  limitBypass?: boolean
  /** Etapa de onde uma ação `detach_and_reenter` tirou o fluxo (ver `enterStage`). */
  detachedFrom?: string | null
  /** Resposta ao Claude no passo parado; o próximo início desse passo a manda na mesma sessão. */
  pendingReply?: { stepId: string; text: string } | null
}

const ACTIVE_SQL = `(${ACTIVE_FLOW_STATUSES.map((s) => `'${s}'`).join(', ')})`
const ACTIVE: readonly FlowRunStatus[] = ACTIVE_FLOW_STATUSES
/** Pausas de fila (vaga do projeto ou do agente): começam sozinhas. */
const QUEUE_SQL = `(${FLOW_PAUSE_REASONS.filter((r) => FLOW_PAUSES[r].waits === 'queue')
  .map((r) => `'${r}'`)
  .join(', ')})`

/** O último fluxo de uma tarefa (para o orquestrador decidir se ela segue). */
export interface LastFlow {
  stageId: string | null
  status: FlowRunStatus
  result: 'done' | 'rejected' | 'cancelled' | null
  startedAt: string
  endedAt: string | null
}

export class FlowRunner {
  /** Briefing e título da tarefa por fluxo (só em memória; refeitos ao retomar). */
  private readonly briefings = new Map<string, { briefing: string; title?: string }>()
  /** Execução da 4A → passo do fluxo. */
  private readonly runIndex = new Map<string, { flowRunId: string; rowId: number }>()
  private readonly gateTimers = new Map<string, NodeJS.Timeout>()
  /** "Antes do passo" dos extratores, por execução da 4A (só em memória). */
  private readonly snapshots = new Map<string, unknown>()
  /** Mensagem que interrompeu o passo rodando: ao terminar o cancelamento, o passo segue com ela. */
  private readonly interrupts = new Map<string, string>()
  private readonly locks = new Map<string, Promise<void>>()
  /** Fechando o app: fins de execução (cancelAll) não contam; ao reabrir viram "interrompido". */
  private disposed = false

  constructor(private readonly deps: FlowRunnerDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  /**
   * Ao abrir o app: o que estava rodando (ou entre passos) vira "interrompido" e pausa; gate
   * continua em gate (timer rearmado); decisão pendente continua pendente.
   */
  init(): void {
    const at = this.now()
    for (const row of this.deps.db.all<RunRow>(
      `SELECT * FROM flow_runs WHERE status IN ${ACTIVE_SQL}`
    )) {
      if (row.status === 'running') {
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'interrupted', ended_at = ? WHERE flow_run_id = ? AND status = 'running'`,
          at,
          row.id
        )
        // Ao abrir o app, sem notificação: o sino e a lista mostram o que parou.
        this.pause(row, 'interrupted', { body: null })
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

  /** Da entrada na etapa (`enterStage`, dentro da transação do quadro): adia o trabalho. */
  onStageChanged(change: StageChange): void {
    setImmediate(() => void this.handleStageChange(change))
  }

  private async handleStageChange(change: StageChange): Promise<void> {
    try {
      const active = this.activeRow(change.taskId)
      if (active && active.stage_id !== null && change.from === active.stage_id) {
        if (change.to === active.stage_id) return
        // A automação (3B) moveu a tarefa por causa do passo (ex.: a PR aberta, a revisão
        // publicada): o passo diz se isso é consequência (segue sem acompanhar a etapa) ou se
        // pergunta, como numa saída qualquer.
        const behavior = change.source === 'automation' ? this.onStageMoved(active) : 'ask'
        if (behavior !== 'ask') {
          this.deps.db.run(`UPDATE flow_runs SET stage_id = NULL WHERE id = ?`, active.id)
          // Mover a tarefa era o objetivo do passo: a coluna nova começa o fluxo dela quando este
          // terminar. Com `detach` (ex.: /pr → Revisando), a coluna nova fica com o orquestrador.
          if (behavior === 'detach_and_reenter') {
            this.savePersisted(active.id, {
              ...this.persisted(active),
              detachedFrom: active.stage_id
            })
          }
          this.deps.emit({ projectId: active.project_id, taskId: active.task_page_id })
          return
        }
        await this.leftStage(active.id)
        return
      }
      if (!isStageEntry(change) || active) return
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

  /**
   * O que o passo atual faz quando a automação move a tarefa: comando em modo entrega = `detach`
   * (o `/pr` abre a PR); ação = o que ela declara; o resto pergunta.
   */
  private onStageMoved(row: RunRow): StageMoveBehavior {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    if (step?.type === 'claude_command') return step.delivery === true ? 'detach' : 'ask'
    if (step?.type === 'orkio_action') {
      return this.deps.actions.find((a) => a.id === step.action)?.onStageMoved ?? 'ask'
    }
    return 'ask'
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
   * Um fluxo do app (ex.: "Abrir PR"), que não precisa estar na config do projeto. Mesmas
   * validações do `startById` (um fluxo por tarefa, pré-checagem do alva-flow, regras do agente);
   * a cópia vai para `flow_json` e não acompanha a etapa.
   */
  async startBuiltin(projectId: string, taskId: string, flow: Flow): Promise<FlowRunView> {
    return this.start(projectId, taskId, null, flow.id, false, flow)
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
    useAgentFlow: boolean,
    builtin: Flow | null = null
  ): Promise<FlowRunView> {
    if (this.activeRow(taskId)) throw new FlowError('busy', FLOW_MESSAGES.busy)
    const agent = await this.deps.agentFor(projectId, taskId)
    const flows = this.deps.flows(projectId).flows
    const preferred = useAgentFlow && agent?.profile.flow ? agent.profile.flow : null
    const flowId = preferred && flows.some((f) => f.id === preferred) ? preferred : columnFlowId
    const flow = builtin ?? flows.find((f) => f.id === flowId)
    if (!flow) throw new FlowError('flow_missing', FLOW_MESSAGES.flowMissing)
    if (agent) {
      const denied = checkAgentFlow(agent.profile, flow)
      if (denied) throw new FlowError('agent_denied', denied)
    }
    for (const integration of this.integrations(flow)) {
      const blocked = await integration.canStart(projectId)
      if (blocked) throw new FlowError('not_ready', blocked)
    }
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
        flowId: flow.id,
        flow: flow.name,
        ...(agent ? { agent: agent.profile.name, agentKey: agent.key } : {}),
        ...(waits ? { waiting: true } : {})
      })
    })
    this.deps.emit({ projectId, taskId })
    if (!waits) await this.withLock(id, () => this.begin(id))
    return this.view(id)
  }

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
    const vars: Record<string, string> = {}
    for (const integration of this.integrations(this.flow(row))) {
      try {
        Object.assign(vars, await integration.initialVars(row.project_id, row.task_page_id))
      } catch (error) {
        console.error(`[orkio] fluxo (variáveis iniciais): ${errorName(error)}`)
      }
    }
    return cleanVars(vars)
  }

  private integrations(flow: Flow): FlowIntegration[] {
    return integrationsOf(this.deps.integrations, flow.tags)
  }

  /**
   * Cabe mais um fluxo? `null` = sim; senão o motivo da espera: limite de uma integração do fluxo
   * no projeto (`waiting_slot`, ex.: Alva com Docker) ou do agente em todas as tarefas
   * (`waiting_agent`). Quem está na fila não ocupa vaga.
   */
  private slot(
    projectId: string,
    flow: Flow,
    agent: FlowAgent | null,
    self: string | null = null
  ): 'waiting_slot' | 'waiting_agent' | null {
    const active = this.deps.db
      .all<RunRow>(`SELECT * FROM flow_runs WHERE status IN ${ACTIVE_SQL}`)
      .filter(
        (r) =>
          r.id !== self &&
          waitingKind({ status: r.status, pauseReason: r.pause_reason }) !== 'queue'
      )
    for (const integration of this.integrations(flow)) {
      const limit = integration.concurrencyLimit(projectId)
      if (limit === null) continue
      const busy = active.filter(
        (r) => r.project_id === projectId && this.flow(r).tags?.includes(integration.tag)
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
      `SELECT * FROM flow_runs WHERE status = 'paused' AND pause_reason IN ${QUEUE_SQL} ORDER BY started_at`
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
      if (step?.type !== 'claude_command')
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      const r = ex?.resolveChoice
        ? await ex.resolveChoice({ ctx: this.extractContext(row, step), value })
        : {}
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
      if (step?.type === 'orkio_action') {
        this.savePersisted(flowRunId, { ...p, pendingConfirm: null })
        this.event(row, outcome === 'approved' ? 'gate_approved' : 'gate_rejected', {
          step: row.current_step
        })
        if (outcome === 'rejected') {
          this.closeStep(flowRunId, 'rejected')
          this.finishRun(row, 'finished', 'rejected')
          return
        }
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'running' WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?)`,
          flowRunId
        )
        this.setStatus(flowRunId, 'running', null)
        if (!action) {
          await this.endAction(
            this.row(flowRunId),
            step,
            { outcome: 'failed' },
            unknownAction(step)
          )
          return
        }
        await this.execAction(
          this.row(flowRunId),
          step,
          action,
          input,
          p.pendingConfirm ?? undefined
        )
        return
      }
      this.closeStep(flowRunId, outcome)
      this.event(row, outcome === 'approved' ? 'gate_approved' : 'gate_rejected', {
        step: row.current_step
      })
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
      await this.retryPaused(row, row.current_step, {})
    })
    return this.view(flowRunId)
  }

  /**
   * Você decidiu seguir de um passo parado ("Retomar" ou "Responder e continuar"): o limite de
   * passos ainda conta, mas a trava zera; o limite do dia do agente fica liberado para o próximo
   * comando. `extra` vai junto no estado salvo (ex.: a resposta).
   */
  private async retryPaused(row: RunRow, stepId: string, extra: Partial<Persisted>): Promise<void> {
    const p = this.persisted(row)
    const engine = row.pause_reason === 'loop_guard' ? { ...p.engine, executed: 0 } : p.engine
    this.savePersisted(row.id, {
      ...p,
      ...extra,
      ...(row.pause_reason === 'agent_daily_limit' ? { limitBypass: true } : {})
    })
    await this.apply(row.id, retryStep(this.flow(row), engine, stepId))
  }

  /**
   * "Responder e continuar": você responde ao Claude (ex.: as perguntas que ficaram sem resposta)
   * e o passo parado segue na MESMA sessão, sem rodar o comando do zero. Só num comando do Claude
   * Code, com o fluxo pausado por falha, interrupção ou limite.
   */
  async resumeWithReply(flowRunId: string, text: string): Promise<FlowRunView> {
    const reply = text.trim()
    if (!reply) throw new FlowError('invalid_reply', FLOW_MESSAGES.emptyReply)
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (!this.acceptsReply(row) || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      await this.retryPaused(row, row.current_step, {
        pendingReply: { stepId: row.current_step, text: reply }
      })
    })
    return this.view(flowRunId)
  }

  /**
   * "Pedir ajustes…" no gate atual da tarefa (gate com `revise`): o seu texto (sem segredos) vai
   * para o passo `revise.step`, que roda de novo na MESMA sessão do Claude Code; depois o gate
   * aparece outra vez. Passou do limite de voltas → recusado.
   */
  async reviseGate(taskId: string, text: string, projectId?: string): Promise<FlowRunView> {
    const typed = text.trim()
    if (!typed) throw new FlowError('invalid_reply', FLOW_MESSAGES.emptyRevise)
    if (typed.length > MAX_PROMPT_CHARS) {
      throw new FlowError('invalid_reply', FLOW_MESSAGES.longRevise)
    }
    const found = this.activeRow(taskId)
    if (!found || (projectId !== undefined && found.project_id !== projectId)) {
      throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
    }
    const flowRunId = found.id
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      const flow = this.flow(row)
      const gate = flow.steps.find((s) => s.id === row.current_step)
      if (row.status !== 'waiting_gate' || gate?.type !== 'gate') {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      const p = this.persisted(row)
      const decision = reviseGate(flow, p.engine, gate.id)
      if (decision.kind === 'refused') {
        throw decision.reason === 'limit'
          ? new FlowError('revise_limit', FLOW_MESSAGES.reviseLimit(decision.max))
          : new FlowError('not_revisable', FLOW_MESSAGES.notRevisable)
      }
      const target = flow.steps.find((s) => s.id === gate.revise?.step)
      const readOnly = target?.type === 'claude_command' && target.readOnly === true
      const reply = [
        redactSecrets(typed),
        '---',
        `Refaça a sua resposta anterior com esse ajuste e mande a versão completa de novo.${readOnly ? ' Não altere arquivos.' : ''}`
      ].join('\n\n')
      this.clearGateTimer(flowRunId)
      // O banco não tem o estado "ajustes pedidos" (CHECK da v6): grava como pulado com a marca;
      // a visão mostra `revised`.
      this.closeStep(flowRunId, 'skipped', { message: 'Ajustes pedidos', revised: true })
      this.event(row, 'gate_revised', {
        step: gate.id,
        round: decision.state.revisions?.[gate.id] ?? 1
      })
      if (decision.kind === 'run') {
        this.savePersisted(flowRunId, {
          ...p,
          pendingReply: { stepId: decision.stepId, text: reply }
        })
      }
      await this.apply(flowRunId, decision)
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
      if (running) this.closeStep(flowRunId, 'cancelled', { message: 'Fluxo cancelado.' })
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

  onRunFinished(info: RunFinished): void {
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
      let message = info.message
      let code: string | null = info.code
      let link: string | null = null
      if (info.status === 'succeeded' && step?.type === 'claude_command' && step.extract) {
        extracted = await this.extract(row, step, info.resultText, info.runId)
      }
      if (info.status === 'succeeded' && extracted.fail) {
        end = { outcome: 'failed' }
        message = extracted.fail.message
        code = extracted.fail.code
        link = extracted.fail.link ?? null
      } else if (info.status === 'succeeded') {
        end = { outcome: 'ok', vars: cleanVars(extracted.vars ?? {}) }
      } else {
        end = { outcome: info.status === 'cancelled' ? 'cancelled' : 'failed' }
      }
      this.closeStep(
        ref.flowRunId,
        end.outcome === 'ok' ? 'ok' : end.outcome === 'cancelled' ? 'cancelled' : 'failed',
        { message, code: end.outcome === 'ok' ? null : code, link, costUsd: info.costUsd }
      )
      this.event(row, end.outcome === 'ok' ? 'step_finished' : 'step_failed', {
        step: current.step_id,
        runId: info.runId,
        ...(message ? { message } : {})
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
        this.pause(row, 'needs_choice', {
          step: current.step_id,
          body: extracted.choose.prompt
        })
        return
      }
      if (row.status === 'awaiting_decision') {
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
    })
      .then(async () => {
        // Você mandou uma mensagem com o passo rodando: o cancelamento pausou o fluxo; o passo
        // segue na mesma sessão com a sua mensagem (como no Claude Code).
        const reply = this.interrupts.get(ref.flowRunId)
        if (reply === undefined) return
        this.interrupts.delete(ref.flowRunId)
        await this.resumeWithReply(ref.flowRunId, reply)
      })
      .catch((error: unknown) => {
        console.error(`[orkio] fluxo (fim de execução): ${errorName(error)}`)
      })
  }

  /**
   * Mensagem do campo da sessão com um fluxo ativo na tarefa (como no Claude Code: a mensagem
   * nunca fica parada atrás do piloto automático):
   * - esperando uma escolha (ex.: qual task do Backlog): a mensagem que cita uma das opções (ID
   *   como TASK-5) escolhe essa e o fluxo segue; sem citar, erro pedindo a opção;
   * - passo do Claude Code rodando: interrompe e o passo continua na mesma sessão com a mensagem;
   * - parado por um problema num comando do Claude Code (`acceptsReply`): "Responder e continuar";
   * - gate com "Pedir ajustes" esperando você: a mensagem vira o pedido de ajuste (`reviseGate`).
   * `null` = o fluxo não usa a mensagem (gate, sem fluxo...): ela vai para o Claude como sempre.
   */
  async handleMessage(
    taskId: string,
    text: string,
    /** Nota dos anexos: vai com o texto para o Claude, mas não entra no casamento da escolha. */
    note = ''
  ): Promise<'choice' | 'interrupt' | 'reply' | 'revise' | null> {
    const typed = text.trim()
    const message = typed + note
    const row = this.activeRow(taskId)
    if (!row || !typed) return null
    const p = this.persisted(row)
    if (row.status === 'paused' && row.pause_reason === 'needs_choice' && p.pendingChoice) {
      const value = matchChoice(typed, p.pendingChoice.options)
      if (!value) throw new FlowError('choice_unclear', FLOW_MESSAGES.choiceUnclear)
      await this.choose(row.id, value)
      return 'choice'
    }
    const step = row.current_step
      ? this.flow(row).steps.find((st) => st.id === row.current_step)
      : undefined
    if (row.status === 'waiting_gate' && step?.type === 'gate' && step.revise) {
      await this.reviseGate(taskId, message)
      return 'revise'
    }
    if (step?.type !== 'claude_command') return null
    if (row.status === 'running') {
      const runId = [...this.runIndex.entries()].find(([, ref]) => ref.flowRunId === row.id)?.[0]
      if (!runId) return null
      this.interrupts.set(row.id, message)
      this.deps.cancelClaude(runId)
      return 'interrupt'
    }
    if (this.acceptsReply(row)) {
      await this.resumeWithReply(row.id, message)
      return 'reply'
    }
    return null
  }

  /** A sua mensagem volta ao passo parado (`acceptsReply`, a mesma regra da tela)? */
  private acceptsReply(row: RunRow): boolean {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    return acceptsReply({ status: row.status, pauseReason: row.pause_reason }, step)
  }

  list(taskId: string): FlowRunView[] {
    return this.deps.db
      .all<{ id: string }>(
        'SELECT id FROM flow_runs WHERE task_page_id = ? ORDER BY started_at DESC LIMIT 10',
        taskId
      )
      .map((r) => this.view(r.id))
  }

  /** Para o card do quadro: tarefas com fluxo ativo e se ele espera você. */
  activeForProject(projectId: string): Record<string, TaskFlowActivity> {
    const out: Record<string, TaskFlowActivity> = {}
    for (const r of this.deps.db.all<{
      task_page_id: string
      status: FlowRunStatus
      pause_reason: FlowPauseReason | null
    }>(
      `SELECT task_page_id, status, pause_reason FROM flow_runs WHERE project_id = ? AND status IN ${ACTIVE_SQL}`,
      projectId
    )) {
      out[r.task_page_id] = needsYou({ status: r.status, pauseReason: r.pause_reason })
        ? 'needs_you'
        : 'running'
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

  activeViews(): FlowRunView[] {
    return this.deps.db
      .all<{ id: string }>(
        `SELECT id FROM flow_runs WHERE status IN ${ACTIVE_SQL} ORDER BY started_at`
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
      waitingKind({ status: row.status, pauseReason: row.pause_reason }) === 'queue'
    )
  }

  /** Fluxos ativos por agente (todos os projetos), contando os que esperam vaga. */
  activeCountByAgent(): Map<string, number> {
    const out = new Map<string, number>()
    for (const r of this.deps.db.all<{ agent_key: string; n: number }>(
      `SELECT agent_key, COUNT(*) AS n FROM flow_runs WHERE agent_key IS NOT NULL AND status IN ${ACTIVE_SQL} GROUP BY agent_key`
    )) {
      out.set(r.agent_key, r.n)
    }
    return out
  }

  activeTasks(projectId: string): { taskId: string; agentKey: string | null }[] {
    return this.deps.db
      .all<{ task_page_id: string; agent_key: string | null }>(
        `SELECT task_page_id, agent_key FROM flow_runs WHERE project_id = ? AND status IN ${ACTIVE_SQL} ORDER BY started_at`,
        projectId
      )
      .map((r) => ({ taskId: r.task_page_id, agentKey: r.agent_key }))
  }

  lastFlow(taskId: string): LastFlow | null {
    const r = this.deps.db.get<RunRow>(
      'SELECT * FROM flow_runs WHERE task_page_id = ? ORDER BY started_at DESC LIMIT 1',
      taskId
    )
    return r
      ? {
          stageId: r.stage_id,
          status: r.status,
          result: r.result,
          startedAt: r.started_at,
          endedAt: r.ended_at
        }
      : null
  }

  counts(): { total: number; active: number } {
    const n = (sql: string): number => this.deps.db.get<{ n: number }>(sql)?.n ?? 0
    return {
      total: n('SELECT COUNT(*) AS n FROM flow_runs'),
      active: n(`SELECT COUNT(*) AS n FROM flow_runs WHERE status IN ${ACTIVE_SQL}`)
    }
  }

  view(flowRunId: string): FlowRunView {
    const row = this.row(flowRunId)
    const flow = this.flow(row)
    const engine = this.persisted(row).engine
    const history = this.deps.db
      .all<StepRow>('SELECT * FROM flow_steps WHERE flow_run_id = ? ORDER BY id', flowRunId)
      .map((s, i): FlowStepView => {
        const r = s.result_json
          ? (JSON.parse(s.result_json) as {
              message?: string
              code?: string
              link?: string
              costUsd?: number | null
              revised?: boolean
            })
          : {}
        return {
          seq: i + 1,
          stepId: s.step_id,
          runId: s.run_id,
          status: r.revised === true ? 'revised' : s.status,
          startedAt: s.started_at,
          endedAt: s.ended_at,
          message: r.message ?? null,
          code: r.code ?? null,
          link: r.link ?? null,
          costUsd: r.costUsd ?? null
        }
      })
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_page_id,
      flowId: row.flow_id,
      flowName: flow.name,
      // Mensagens dos gates com as variáveis do fluxo (ex.: "Aprovar correções da PR #13").
      steps: flow.steps.map((s) =>
        s.type === 'gate' ? { ...s, message: renderMessage(s.message, engine.vars) } : s
      ),
      status: row.status,
      currentStep: row.current_step,
      pauseReason: row.pause_reason,
      result: row.result,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      vars: engine.vars,
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
      })(),
      revise:
        row.status === 'waiting_gate'
          ? gateRevisions(
              flow.steps.find((s) => s.id === row.current_step),
              engine
            )
          : null
    }
  }

  private async apply(flowRunId: string, decision: FlowDecision): Promise<void> {
    const row = this.row(flowRunId)
    const p = this.persisted(row)
    this.savePersisted(flowRunId, { ...p, engine: decision.state })
    if (decision.kind === 'finished') {
      this.finishRun(row, 'finished', decision.result)
      return
    }
    if (decision.kind === 'paused') {
      this.pause(row, decision.reason, { step: decision.stepId })
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
    if (!agent || step?.type !== 'claude_command') return false
    const p = this.persisted(row)
    if (p.limitBypass) {
      this.savePersisted(flowRunId, { ...p, limitBypass: false })
      return false
    }
    const problem = this.deps.agentLimit(agent)
    if (!problem) return false
    this.pause(row, 'agent_daily_limit', { step: stepId, body: problem })
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
        this.notifyRow(
          row,
          'Um fluxo espera sua aprovação',
          renderMessage(step.message, this.persisted(this.row(row.id)).engine.vars)
        )
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
      const ex = step.extract
        ? this.deps.extractors.find((e) => e.id === step.extract!.extractor)
        : undefined
      const snap = ex?.snapshot
        ? await ex.snapshot(this.extractContext(row, step)).catch(() => undefined)
        : undefined
      const prompt = isPromptStep(step)
      const { text, missing } = renderArgs(prompt ? step.prompt! : step.args, {
        briefingPath: BRIEFING_PATH,
        taskId: ctx.displayId,
        ...(ctx.title ? { taskTitle: ctx.title } : {}),
        notionUrl: ctx.notionUrl,
        vars: this.persisted(this.row(row.id)).engine.vars
      })
      // Variável de uma integração sem valor (ex.: a task do Backlog não foi vinculada): o comando
      // rodaria com o argumento vazio e gastaria uma execução à toa. Para antes de começar.
      const lacking = this.deps.integrations.find((i) =>
        missing.some((name) => name.startsWith(i.varPrefix))
      )
      if (lacking) throw new FlowError(lacking.missingVar.code, lacking.missingVar.message)
      const persisted = this.persisted(this.row(row.id))
      const reply =
        persisted.pendingReply?.stepId === step.id ? persisted.pendingReply.text : undefined
      if (reply !== undefined) this.savePersisted(row.id, { ...persisted, pendingReply: null })
      const fresh = {
        kind: 'new',
        briefing: ctx.briefing,
        includeBriefing: step.includeBriefing !== false
      } as const
      const runId = await this.deps.startClaude({
        projectId: row.project_id,
        taskId: row.task_page_id,
        // Resposta sua: continua a sessão do passo parado com ela (sem rodar o comando de novo).
        // Pedido em texto: continua a sessão mais recente (ou começa uma). Comando: sessão nova.
        input:
          reply !== undefined
            ? { kind: 'prompt', text: reply }
            : prompt
              ? { kind: 'prompt', text }
              : { kind: 'command', name: step.command, args: text },
        session:
          reply !== undefined
            ? { kind: 'latest', orNew: null }
            : prompt
              ? { kind: 'latest', orNew: fresh }
              : fresh,
        // Só leitura nunca entrega (o validador já recusa os dois juntos).
        access:
          step.readOnly === true
            ? { tools: 'read_only', github: 'read' }
            : { tools: 'full', github: step.delivery === true ? 'deliver' : 'read' },
        agent: this.runAgent(row),
        runtime:
          step.model !== undefined || step.effort !== undefined
            ? {
                ...(step.model !== undefined ? { model: step.model } : {}),
                ...(step.effort !== undefined ? { effort: step.effort } : {})
              }
            : null,
        timeoutMin: step.timeoutMin
      })
      this.deps.db.run('UPDATE flow_steps SET run_id = ? WHERE id = ?', runId, rowId)
      this.runIndex.set(runId, { flowRunId: row.id, rowId })
      if (snap !== undefined) this.snapshots.set(runId, snap)
      this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
    } catch (error) {
      // Não iniciou (Claude Code ausente, worktree, variável faltando...): falha, o fluxo pausa.
      const failure: StepFailure =
        error instanceof FlowError
          ? { code: error.code, message: error.message }
          : { code: FLOW_FAILURES.startFailed, message: 'Não foi possível iniciar o Claude Code.' }
      if (!(error instanceof FlowError)) {
        console.error(`[orkio] fluxo (iniciar comando): ${errorName(error)}`)
      }
      this.closeStep(row.id, 'failed', failure)
      this.event(row, 'step_failed', { step: step.id, message: failure.message })
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
    if (!action) {
      await this.endAction(row, step, { outcome: 'failed' }, unknownAction(step))
      return
    }
    if (action.confirm) {
      let info: ActionConfirm | { problem: StepFailure } | null
      try {
        info = await action.confirm({
          projectId: row.project_id,
          taskId: row.task_page_id,
          vars: this.persisted(this.row(row.id)).engine.vars,
          lastRunId: this.lastRunId(row.id)
        })
      } catch (error) {
        console.error(`[orkio] ação do fluxo (confirmar): ${errorName(error)}`)
        info = {
          problem: {
            code: FLOW_FAILURES.actionFailed,
            message: 'Não foi possível preparar a ação do Orkio.'
          }
        }
      }
      if (info && 'problem' in info) {
        await this.endAction(row, step, { outcome: 'failed' }, info.problem)
        return
      }
      if (info) {
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
    input?: string[],
    confirmed?: ActionConfirm
  ): Promise<void> {
    const engine = this.persisted(this.row(row.id)).engine
    let end: StepEnd
    let failure: StepFailure | null = null
    try {
      const r = await action.run({
        projectId: row.project_id,
        taskId: row.task_page_id,
        vars: engine.vars,
        lastRunId: this.lastRunId(row.id),
        ...(input ? { input } : {}),
        ...(confirmed ? { confirmed } : {})
      })
      if (r.ok) end = { outcome: 'ok', ...(r.vars ? { vars: cleanVars(r.vars) } : {}) }
      else {
        end = { outcome: 'failed' }
        failure = { code: r.code, message: r.message, ...(r.link ? { link: r.link } : {}) }
      }
    } catch (error) {
      console.error(`[orkio] ação do fluxo: ${errorName(error)}`)
      end = { outcome: 'failed' }
      failure = { code: FLOW_FAILURES.actionFailed, message: 'A ação do Orkio falhou.' }
    }
    await this.endAction(row, step, end, failure)
  }

  private lastRunId(flowRunId: string): string | null {
    return (
      this.deps.db.get<{ run_id: string }>(
        `SELECT run_id FROM flow_steps WHERE flow_run_id = ? AND run_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
        flowRunId
      )?.run_id ?? null
    )
  }

  private async endAction(
    row: RunRow,
    step: Extract<Step, { type: 'orkio_action' }>,
    end: StepEnd,
    failure: StepFailure | null
  ): Promise<void> {
    const engine = this.persisted(this.row(row.id)).engine
    this.closeStep(row.id, end.outcome === 'ok' ? 'ok' : 'failed', failure ?? {})
    this.event(row, end.outcome === 'ok' ? 'step_finished' : 'step_failed', {
      step: step.id,
      ...(failure ? { message: failure.message } : {})
    })
    await this.apply(row.id, afterStep(this.flow(row), engine, step.id, end))
  }

  private async leftStage(flowRunId: string): Promise<void> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (!ACTIVE.includes(row.status) || row.status === 'awaiting_decision') return
      this.clearGateTimer(flowRunId)
      this.pause(row, 'left_stage', {
        title: FLOW_PAUSES.left_stage.label,
        body: FLOW_PAUSES.left_stage.notify
      })
    })
  }

  private finishRun(row: RunRow, status: 'finished' | 'cancelled', result: RunRow['result']): void {
    // O gate de uma ação guarda o que ia acontecer (ex.: o texto da revisão a publicar): terminado
    // o fluxo (concluído, recusado ou cancelado), nada disso fica no banco.
    const p = this.persisted(this.row(row.id))
    if (p.pendingConfirm) this.savePersisted(row.id, { ...p, pendingConfirm: null })
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
    this.deps.onFinished({ projectId: row.project_id, taskId: row.task_page_id, result })
    // Concluído depois de um passo `detach_and_reenter` mudar a etapa: a coluna onde a tarefa está
    // agora começa o fluxo dela (ex.: revisão publicada com "Pedir alterações" → Revisado →
    // comentários da PR).
    const from = p.detachedFrom ?? null
    if (status === 'finished' && result === 'done' && from) {
      const to = this.deps.currentStage(row.project_id, row.task_page_id)
      if (to && to !== from) {
        this.deps.enterStage({
          projectId: row.project_id,
          taskId: row.task_page_id,
          from,
          to,
          source: 'automation'
        })
      }
    }
  }

  private closeStep(
    flowRunId: string,
    status: FlowStepStatus,
    info: {
      message?: string | null
      code?: string | null
      link?: string | null
      costUsd?: number | null
      revised?: true
    } = {}
  ): void {
    const { message, code, link, ...extra } = info
    const result = {
      ...(message ? { message } : {}),
      ...(code ? { code } : {}),
      ...(link ? { link } : {}),
      ...extra
    }
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
          this.closeStep(row.id, 'cancelled', { message: 'A aprovação expirou.' })
          this.pause(r, 'gate_timeout', { body: FLOW_PAUSES.gate_timeout.notify })
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
    step: ClaudeCommandStep,
    resultText: string,
    runId: string
  ): Promise<ExtractResult> {
    const extractorId = step.extract?.extractor ?? ''
    const ex = this.deps.extractors.find((e) => e.id === extractorId)
    const snapshot = this.snapshots.get(runId)
    this.snapshots.delete(runId)
    if (!ex) return {}
    try {
      return await ex.extract({
        resultText,
        ctx: this.extractContext(row, step),
        snapshot
      })
    } catch (error) {
      console.error(`[orkio] extrator ${extractorId}: ${errorName(error)}`)
      return {}
    }
  }

  private runAgent(row: RunRow): RunAgent | null {
    const a = this.agentOf(row)
    return a ? toRunAgent(a) : null
  }

  private extractContext(row: RunRow, step: ClaudeCommandStep): ExtractContext {
    return {
      projectId: row.project_id,
      taskId: row.task_page_id,
      step,
      worktreePath: this.deps.worktreePath(row.task_page_id)
    }
  }

  /**
   * Pausa o fluxo (a tarefa saiu da etapa = esperando decisão): grava o motivo e o passo (se veio),
   * registra no histórico, avisa você (`body: null` = sem notificação) e a tela.
   */
  private pause(
    row: RunRow,
    reason: FlowPauseReason,
    options: { step?: string | null; title?: string; body?: string | null } = {}
  ): void {
    const step = options.step ?? null
    this.deps.db.run(
      `UPDATE flow_runs SET status = ?, pause_reason = ?, current_step = COALESCE(?, current_step) WHERE id = ?`,
      reason === 'left_stage' ? 'awaiting_decision' : 'paused',
      reason,
      step,
      row.id
    )
    this.event(row, 'flow_paused', { reason, step: step ?? row.current_step })
    const body = options.body === undefined ? this.pauseText(reason, row) : options.body
    if (body !== null) this.notifyRow(row, options.title ?? 'Um fluxo precisa de você', body)
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
  }

  private pauseText(reason: FlowPauseReason, row: RunRow): string {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    return `${FLOW_PAUSES[reason].notify}${step ? ` (${step.name})` : ''}`
  }

  private notifyRow(row: RunRow, title: string, body: string): void {
    this.deps.notify(title, body, { projectId: row.project_id, taskId: row.task_page_id })
  }

  private event<K extends FlowEventKind>(
    row: RunRow,
    kind: K,
    detail: Omit<TaskEventDetailInput<K>, 'flowRunId' | 'stepName'>
  ): void {
    const fields: Record<string, unknown> = { flowRunId: row.id, ...detail }
    // O histórico mostra o nome do passo (o id é chave interna, ex.: "ok").
    if (typeof fields['step'] === 'string') {
      try {
        const name = (JSON.parse(row.flow_json) as Flow).steps.find(
          (s) => s.id === fields['step']
        )?.name
        if (name) fields['stepName'] = name
      } catch {
        // flow_json ilegível: fica só o id.
      }
    }
    this.deps.store.addEvent({
      taskPageId: row.task_page_id,
      projectId: row.project_id,
      at: this.now(),
      kind,
      detail: fields
    } as TaskEventInput)
  }

  private activeRow(taskId: string): RunRow | null {
    return (
      this.deps.db.get<RunRow>(
        `SELECT * FROM flow_runs WHERE task_page_id = ? AND status IN ${ACTIVE_SQL} ORDER BY started_at DESC LIMIT 1`,
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

/** Ação de teste. */
export const NOOP_ACTION: OrkioAction = {
  ...ORKIO_ACTIONS.noop,
  run: async () => ({ ok: true })
}

function unknownAction(step: Extract<Step, { type: 'orkio_action' }>): StepFailure {
  return { code: FLOW_FAILURES.unknownAction, message: `Ação desconhecida: ${step.action}` }
}

/** Variáveis do fluxo: chaves válidas, valores curtos e sem segredos. */
export function cleanVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars).slice(0, 30)) {
    if (VAR_KEY.test(k)) out[k] = redactSecrets(String(v)).slice(0, 500)
  }
  return out
}

/** A opção que a mensagem cita pelo valor (ex.: "é a task-5" → TASK-5); várias ou nenhuma = null. */
export function matchChoice(
  message: string,
  options: readonly { value: string; label: string }[]
): string | null {
  const norm = (v: string): string => v.toLowerCase().replace(/[\s_]+/g, '-')
  const text = norm(message)
  const hits = options.filter((o) => {
    const v = norm(o.value)
    const at = text.indexOf(v)
    if (at < 0) return false
    // Não casa TASK-5 dentro de TASK-50.
    const after = text[at + v.length]
    return after === undefined || !/[0-9a-z]/.test(after)
  })
  return hits.length === 1 ? hits[0]!.value : null
}

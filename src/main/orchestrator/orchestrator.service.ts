/**
 * Orquestrador de tarefas (Etapa 8B), no main. A cada rodada (depois do ciclo das automações,
 * ~60 s, e logo depois de um fluxo terminar):
 *
 *   quadro (3A) + atribuições (8A) + fluxos (5A) → `planTick` (puro) → atribuir + mover.
 *
 * - Mover usa `applyAutomationMove` (o mesmo caminho das automações): estado local, histórico com
 *   chave única, escrita pendente no Notion e o gatilho do fluxo da coluna. A atribuição entra na
 *   MESMA transação, antes do movimento, para o fluxo começar já com o agente.
 * - Nada de permissão nova: quem trabalha é o fluxo da coluna com o agente, pelas regras do Orkio.
 * - Tarefa que entra numa etapa de trabalho por outro caminho (você, automação) ganha um agente da
 *   etapa (`onStageChanged`), a não ser que você tenha escolhido o agente à mão.
 */
import {
  ORCHESTRATOR_LIMITS,
  defaultOrchestrator,
  laneAgentOnEnter,
  planTick,
  validateOrchestrator,
  type OrchestratorAgentInfo,
  type OrchestratorConfig,
  type OrchestratorState,
  type OrchestratorStatus,
  type PlanAgent,
  type PlanCard,
  type PlanDecision
} from '../../shared/orchestrator'
import { checkAgentFlow, parseAgentKey, type AgentKey, type AgentsState } from '../../shared/agent'
import { builtinAgent } from '../../shared/agent-presets'
import type { BoardService, StageChange } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import type { OrkioConfig } from '../config/orkio-config'
import type { Db } from '../db/database'
import type { ConfigStore } from '../storage/config-store'
import type { AgentRuntime, AgentsService } from '../agents/agents.service'
import type { BoardView } from '../../shared/board'
import type { Result } from '../../shared/result'

export const ORCHESTRATOR_MESSAGES = {
  projectNotFound: 'Projeto não encontrado. Atualize a lista.',
  noBoard: 'Crie o quadro deste projeto antes de ligar o orquestrador.',
  invalid: 'Corrija os erros do orquestrador antes de salvar.',
  moveFailed: 'não foi possível mover a tarefa',
  startFailed: 'o fluxo da etapa não começou'
} as const

export class OrchestratorError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OrchestratorError'
  }
}

/** Status de fluxo que ocupam o agente (inclui esperas e pausas: o trabalho é dele). */
const ACTIVE_SQL = `('running', 'waiting_gate', 'paused', 'awaiting_decision')`
/** Quanto tempo uma tarefa recém-movida conta como "começando" até o fluxo aparecer. */
const STARTING_MS = 2 * 60_000

export interface OrchestratorDeps {
  config: ConfigStore<OrkioConfig>
  db: Db
  store: Pick<BoardStore, 'transaction' | 'addConfigEvent'>
  board: Pick<BoardService, 'get' | 'applyAutomationMove' | 'flushWrites'>
  agents: Pick<
    AgentsService,
    | 'list'
    | 'assignment'
    | 'assignments'
    | 'assignByOrchestrator'
    | 'releaseByOrchestrator'
    | 'limitProblem'
  >
  flows: {
    hasActive(taskId: string): boolean
    /** "Rodar fluxo": o fluxo ligado à etapa atual. Lança `FlowError` com mensagem pt-BR. */
    startManual(projectId: string, taskId: string): Promise<unknown>
  }
  actor(): string
  /** Algo mudou (quadro, agentes, orquestrador): a tela recarrega. */
  emit(projectId: string): void
  now?: () => Date
  schedule?: (fn: () => void, ms: number) => void
}

interface Dispatched {
  projectId: string
  agentKey: AgentKey
  at: number
}

/**
 * Nome do agente sem a lista carregada (antes da primeira rodada): embutido pelo catálogo, senão o
 * id. Nunca o id de um embutido, que o histórico mostraria em minúsculas ("implementador").
 */
export function agentNameFallback(key: AgentKey): string {
  const parsed = parseAgentKey(key)
  if (!parsed) return key
  if (parsed.scope === 'builtin') return builtinAgent(parsed.id)?.name ?? parsed.id
  return parsed.id
}

export class OrchestratorService {
  private readonly now: () => Date
  private readonly schedule: (fn: () => void, ms: number) => void
  private readonly running = new Map<string, Promise<void>>()
  private readonly soon = new Set<string>()
  private readonly status = new Map<string, OrchestratorStatus>()
  /** Agentes vistos na última rodada (para a atribuição síncrona do `onStageChanged`). */
  private readonly agentCache = new Map<string, Map<AgentKey, PlanAgent & { name: string }>>()
  /** Tarefas movidas/atribuídas há pouco cujo fluxo ainda não apareceu. */
  private readonly dispatched = new Map<string, Dispatched>()

  constructor(private readonly deps: OrchestratorDeps) {
    this.now = deps.now ?? (() => new Date())
    this.schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms))
  }

  configFor(projectId: string): OrchestratorConfig {
    return this.deps.config.get().orchestrator[projectId] ?? defaultOrchestrator()
  }

  // ---------- Tela ----------

  async state(projectId: string): Promise<OrchestratorState> {
    const config = this.configFor(projectId)
    const ctx = await this.context(projectId)
    this.agentCache.set(projectId, ctx.plan)
    const loads = this.loadByAgent()
    const keys = new Set(config.lanes.flatMap((l) => l.agents))
    return {
      projectId,
      config,
      validation: validateOrchestrator(config, ctx.stages, ctx.infos, ctx.bindings),
      stages: ctx.stages,
      stagesWithFlow: ctx.bindings
        .filter((b) => b.enabled && b.mode === 'on_enter')
        .map((b) => b.stageId),
      agents: ctx.agents.agents
        .filter((a) => keys.has(a.key) && a.profile)
        .map((a) => {
          const plan = ctx.plan.get(a.key)
          return {
            key: a.key,
            name: a.profile!.name,
            active: loads.get(a.key) ?? 0,
            capacity: a.profile!.limits.parallel,
            limitProblem: plan?.limitProblem ?? null
          }
        }),
      status: this.status.get(projectId) ?? {
        lastRunAt: null,
        error: null,
        working: 0,
        waiting: [],
        lastActions: 0
      }
    }
  }

  /** Salva (o main valida de novo com a mesma função do editor). */
  async save(projectId: string, config: OrchestratorConfig): Promise<OrchestratorState> {
    const project = this.deps.config.get().projects.find((p) => p.id === projectId)
    if (!project) throw new OrchestratorError('not_found', ORCHESTRATOR_MESSAGES.projectNotFound)
    if (!this.deps.config.get().boards[projectId]) {
      throw new OrchestratorError('no_board', ORCHESTRATOR_MESSAGES.noBoard)
    }
    const ctx = await this.context(projectId)
    const validation = validateOrchestrator(config, ctx.stages, ctx.infos, ctx.bindings)
    if (validation.errors.length > 0) {
      throw new OrchestratorError('invalid', validation.errors.join(' '))
    }
    const before = this.configFor(projectId)
    config = {
      ...structuredClone(config),
      enabledSince: !config.enabled
        ? null
        : before.enabled && before.enabledSince
          ? before.enabledSince
          : this.now().toISOString()
    }
    await this.deps.config.update((c) => ({
      ...c,
      orchestrator: { ...c.orchestrator, [projectId]: config }
    }))
    if (
      JSON.stringify({ ...before, enabledSince: null }) !==
      JSON.stringify({ ...config, enabledSince: null })
    ) {
      const name = (id: string | null): string => ctx.stages.find((s) => s.id === id)?.name ?? '—'
      const changes =
        before.enabled !== config.enabled
          ? [config.enabled ? 'Orquestrador ligado' : 'Orquestrador desligado']
          : []
      changes.push(
        'Orquestrador: ' +
          (config.lanes.length === 0
            ? 'sem etapas de trabalho'
            : config.lanes
                .map((l) => `${name(l.stageId)} (${agentCount(l.agents.length)})`)
                .join(' → '))
      )
      this.deps.store.addConfigEvent(
        projectId,
        this.now().toISOString(),
        this.deps.actor(),
        changes
      )
    }
    this.deps.emit(projectId)
    this.runSoon(projectId)
    return this.state(projectId)
  }

  // ---------- Gatilhos ----------

  /** Rodada logo (um fluxo terminou, a config mudou). Junta pedidos próximos. */
  runSoon(projectId: string, ms = 500): void {
    if (!this.configFor(projectId).enabled || this.soon.has(projectId)) return
    this.soon.add(projectId)
    this.schedule(() => {
      this.soon.delete(projectId)
      void this.tick(projectId).catch(() => undefined)
    }, ms)
  }

  /**
   * Do BoardService (dentro da transação do movimento, ANTES do fluxo da coluna): tarefa que entra
   * numa etapa de trabalho por outro caminho ganha um agente da etapa.
   */
  onStageChanged(change: StageChange): void {
    if (change.source !== 'manual' && change.source !== 'automation') return
    if (!change.to) return
    const config = this.configFor(change.projectId)
    if (!config.enabled || this.deps.flows.hasActive(change.taskId)) return
    const agents = this.agentCache.get(change.projectId) ?? new Map()
    // Etapa sem raia (ex.: Revisado): o agente de uma raia não acompanha a tarefa até lá.
    if (!config.lanes.some((l) => l.stageId === change.to)) {
      const current = this.deps.agents.assignment(change.taskId)
      if (current && !current.manual && config.lanes.some((l) => l.agents.includes(current.key))) {
        const name = agents.get(current.key)?.name ?? agentNameFallback(current.key)
        this.deps.agents.releaseByOrchestrator(change.projectId, change.taskId, name)
        this.dispatched.delete(change.taskId)
      }
      return
    }
    const key = laneAgentOnEnter(
      config,
      change.to,
      this.deps.agents.assignment(change.taskId),
      agents,
      this.loadByAgent()
    )
    if (!key) return
    const name = agents.get(key)?.name ?? agentNameFallback(key)
    this.deps.agents.assignByOrchestrator(change.projectId, change.taskId, key, name)
    this.dispatched.set(change.taskId, {
      projectId: change.projectId,
      agentKey: key,
      at: this.now().getTime()
    })
  }

  // ---------- Rodada ----------

  /** Uma rodada por projeto de cada vez (chamadas durante uma rodada esperam a mesma). */
  tick(projectId: string): Promise<void> {
    const current = this.running.get(projectId)
    if (current) return current
    const promise = this.round(projectId).finally(() => this.running.delete(projectId))
    this.running.set(projectId, promise)
    return promise
  }

  private async round(projectId: string): Promise<void> {
    const config = this.configFor(projectId)
    if (!config.enabled) return
    const at = this.now()
    const view = await this.deps.board.get(projectId)
    if (!view.ok || !view.value.config) {
      this.setStatus(projectId, {
        error: view.ok ? ORCHESTRATOR_MESSAGES.noBoard : view.error.message
      })
      return
    }
    const ctx = await this.context(projectId)
    this.agentCache.set(projectId, ctx.plan)
    this.purgeDispatched()

    const cards = toPlanCards(view)
    const busy = this.busyTasks(projectId)
    const lanes = new Set(config.lanes.map((l) => l.stageId))
    const finishedHere = new Set<string>()
    const carriedIn = new Set<string>()
    for (const c of cards) {
      if (!c.stageId || !lanes.has(c.stageId) || busy.has(c.taskId)) continue
      const where = this.lastFlowVsEntry(c.taskId, c.stageId, config.enabledSince)
      if (where === 'finished_here') finishedHere.add(c.taskId)
      else if (where === 'carried_in') carriedIn.add(c.taskId)
    }
    const decisions = planTick({
      config,
      cards,
      assignments: this.deps.agents.assignments(projectId),
      agents: ctx.plan,
      load: this.loadByAgent(),
      busy,
      finishedHere,
      carriedIn
    })
    const waiting: OrchestratorStatus['waiting'] = []
    const display = new Map(cards.map((c) => [c.taskId, c.displayId]))
    const wait = (taskId: string, reason: string): void => {
      if (waiting.length < 20)
        waiting.push({ taskId, displayId: display.get(taskId) ?? '', reason })
    }
    const name = (key: AgentKey | null): string =>
      key ? (ctx.plan.get(key)?.name ?? agentNameFallback(key)) : ''

    // Mover: atribuição + movimento numa transação só.
    let actions = 0
    const moves = decisions.filter(
      (d): d is Extract<PlanDecision, { kind: 'handoff' }> => d.kind === 'handoff'
    )
    if (moves.length > 0) {
      const iso = at.toISOString()
      this.deps.store.transaction(() => {
        for (const d of moves) {
          try {
            if (d.agent) {
              this.deps.agents.assignByOrchestrator(projectId, d.taskId, d.agent, name(d.agent))
            }
            const moved = this.deps.board.applyAutomationMove(projectId, d.taskId, d.to, {
              key: `orchestrator:${d.kind}:${d.taskId}:${d.to}:${iso}`,
              detail: {
                orchestrator: d.kind,
                ...(d.agent ? { agent: name(d.agent), agentKey: d.agent } : {})
              }
            })
            if (moved) {
              actions++
              if (d.agent) {
                this.dispatched.set(d.taskId, { projectId, agentKey: d.agent, at: at.getTime() })
              }
            }
          } catch {
            wait(d.taskId, ORCHESTRATOR_MESSAGES.moveFailed)
          }
        }
      })
      if (actions > 0) this.deps.board.flushWrites()
    }

    // Rodar a etapa atual (a tarefa entrou nela durante a entrega do fluxo anterior).
    for (const d of decisions) {
      if (d.kind === 'wait') wait(d.taskId, d.reason)
      if (d.kind !== 'start') continue
      try {
        this.deps.store.transaction(() =>
          this.deps.agents.assignByOrchestrator(projectId, d.taskId, d.agent, name(d.agent))
        )
        await this.deps.flows.startManual(projectId, d.taskId)
        actions++
      } catch (error) {
        // Mensagens do FlowError são pt-BR e curtas; qualquer outra coisa vira texto genérico.
        wait(
          d.taskId,
          error instanceof Error && error.name === 'FlowError'
            ? error.message
            : ORCHESTRATOR_MESSAGES.startFailed
        )
      }
    }

    this.setStatus(projectId, {
      lastRunAt: at.toISOString(),
      error: null,
      working: this.activeTotal(projectId),
      waiting,
      lastActions: actions
    })
    if (actions > 0 || waiting.length > 0) this.deps.emit(projectId)
  }

  // ---------- Consultas ----------

  /** Fluxos ativos por agente (todos os projetos) + tarefas recém-movidas ainda sem fluxo. */
  private loadByAgent(): Map<AgentKey, number> {
    const out = new Map<AgentKey, number>()
    for (const r of this.deps.db.all<{ agent_key: string; n: number }>(
      `SELECT agent_key, COUNT(*) AS n FROM flow_runs WHERE agent_key IS NOT NULL AND status IN ${ACTIVE_SQL} GROUP BY agent_key`
    )) {
      out.set(r.agent_key, r.n)
    }
    for (const d of this.dispatched.values()) {
      out.set(d.agentKey, (out.get(d.agentKey) ?? 0) + 1)
    }
    return out
  }

  private busyTasks(projectId: string): Set<string> {
    const out = new Set(
      this.deps.db
        .all<{ task_page_id: string }>(
          `SELECT DISTINCT task_page_id FROM flow_runs WHERE project_id = ? AND status IN ${ACTIVE_SQL}`,
          projectId
        )
        .map((r) => r.task_page_id)
    )
    for (const [taskId, d] of this.dispatched) if (d.projectId === projectId) out.add(taskId)
    return out
  }

  /** Tarefas do projeto com agente trabalhando (fluxo ativo) ou começando. */
  private activeTotal(projectId: string): number {
    const tasks = new Set(
      this.deps.db
        .all<{ task_page_id: string }>(
          `SELECT DISTINCT task_page_id FROM flow_runs WHERE project_id = ? AND agent_key IS NOT NULL AND status IN ${ACTIVE_SQL}`,
          projectId
        )
        .map((r) => r.task_page_id)
    )
    for (const [taskId, d] of this.dispatched) if (d.projectId === projectId) tasks.add(taskId)
    return tasks.size
  }

  /** Tira as tarefas recém-movidas cujo fluxo já apareceu (ou que passaram do tempo). */
  private purgeDispatched(): void {
    const nowMs = this.now().getTime()
    for (const [taskId, d] of this.dispatched) {
      const started = this.deps.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM flow_runs WHERE task_page_id = ? AND started_at >= ?',
        taskId,
        new Date(d.at).toISOString()
      )
      if ((started?.n ?? 0) > 0 || nowMs - d.at > STARTING_MS) this.dispatched.delete(taskId)
    }
  }

  /**
   * O último fluxo da tarefa terminou bem e começou depois de ela entrar na etapa atual
   * (`finished_here`), ou já rodava quando ela entrou (`carried_in`)?
   */
  private lastFlowVsEntry(
    taskId: string,
    stageId: string,
    since: string | null
  ): 'finished_here' | 'carried_in' | null {
    const entry = this.deps.db.get<{ at: string | null }>(
      `SELECT MAX(at) AS at FROM task_events WHERE task_page_id = ? AND to_stage = ? AND kind IN ('moved', 'reconciled', 'added')`,
      taskId,
      stageId
    )?.at
    if (!entry) return null
    const last = this.deps.db.get<{
      stage_id: string | null
      status: string
      result: string | null
      started_at: string
      ended_at: string | null
    }>(
      'SELECT stage_id, status, result, started_at, ended_at FROM flow_runs WHERE task_page_id = ? ORDER BY started_at DESC LIMIT 1',
      taskId
    )
    if (!last || last.status !== 'finished' || last.result !== 'done' || !last.ended_at) return null
    if (!since || last.ended_at < since) return null
    if (last.started_at >= entry) return last.stage_id === stageId ? 'finished_here' : null
    return last.ended_at >= entry ? 'carried_in' : null
  }

  /** Agentes do projeto, fluxos ligados às etapas e a checagem estática de cada agente. */
  private async context(projectId: string): Promise<{
    stages: { id: string; name: string }[]
    bindings: OrkioConfig['flows'][string]['bindings']
    agents: AgentsState
    infos: OrchestratorAgentInfo[]
    plan: Map<AgentKey, PlanAgent & { name: string }>
  }> {
    const config = this.deps.config.get()
    const stages = (config.boards[projectId]?.stages ?? []).map((s) => ({ id: s.id, name: s.name }))
    const projectFlows = config.flows[projectId] ?? { flows: [], bindings: [] }
    const agents = await this.deps.agents.list(projectId)
    const plan = new Map<AgentKey, PlanAgent & { name: string }>()
    const infos: OrchestratorAgentInfo[] = []
    const laneKeys = new Set(
      this.configFor(projectId).lanes.flatMap((l) =>
        l.agents.slice(0, ORCHESTRATOR_LIMITS.agentsPerLane)
      )
    )
    for (const a of agents.agents) {
      const name = a.profile?.name ?? a.id
      if (a.profile) {
        const runtime: AgentRuntime = { key: a.key, profile: a.profile }
        plan.set(a.key, {
          key: a.key,
          name,
          ready: a.status === 'ready',
          capacity: a.profile.limits.parallel,
          limitProblem: a.status === 'ready' ? this.deps.agents.limitProblem(runtime) : null
        })
      }
      const deniedByStage: Record<string, string> = {}
      if (a.profile && laneKeys.has(a.key)) {
        for (const b of projectFlows.bindings) {
          const flow = projectFlows.flows.find((f) => f.id === b.flowId)
          const denied = flow && b.enabled ? checkAgentFlow(a.profile, flow) : null
          if (denied) deniedByStage[b.stageId] = denied
        }
      }
      infos.push({ key: a.key, name, status: a.status, deniedByStage })
    }
    for (const key of laneKeys) {
      if (!infos.some((i) => i.key === key)) {
        infos.push({ key, name: agentNameFallback(key), status: 'missing' })
      }
    }
    return { stages, bindings: projectFlows.bindings, agents, infos, plan }
  }

  private setStatus(projectId: string, patch: Partial<OrchestratorStatus>): void {
    const prev = this.status.get(projectId) ?? {
      lastRunAt: null,
      error: null,
      working: 0,
      waiting: [],
      lastActions: 0
    }
    this.status.set(projectId, { ...prev, ...patch })
  }
}

function agentCount(n: number): string {
  return n === 1 ? '1 agente' : `${n} agentes`
}

function toPlanCards(view: Extract<Result<BoardView>, { ok: true }>): PlanCard[] {
  return view.value.cards.map((c, index) => ({
    taskId: c.taskId,
    displayId: c.displayId ?? 'Tarefa',
    stageId: c.stageId,
    priority: c.priority?.name ?? null,
    blocked: c.blocked,
    automationPaused: c.automationPaused,
    index
  }))
}

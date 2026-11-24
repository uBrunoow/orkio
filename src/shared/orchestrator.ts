/**
 * Orquestrador de tarefas (Etapa 8B): passa cada tarefa para a etapa seguinte quando o fluxo da
 * etapa termina bem, com o agente da etapa. NÃO puxa tarefas da fila: quem decide começar é você
 * (mover para a primeira etapa de trabalho), depois de entender a tarefa. Puro: usado no main (decidir a
 * cada rodada) e no renderer (editor e validação).
 *
 * Regras:
 * - O orquestrador só ATRIBUI e MOVE (o mesmo caminho das automações da 3B). Quem trabalha é o
 *   fluxo ligado à coluna (5A), com o agente (8A): gates, push e falhas continuam parando em você.
 * - Passar adiante não espera vaga: o fluxo da etapa seguinte fica na fila do agente
 *   (`waiting_agent`) e começa sozinho. `queueStageId`/`maxActive` ficam na config por
 *   compatibilidade (versões antigas puxavam da fila) e não são mais usados.
 * - Tarefa bloqueada, com automações pausadas ou com fluxo ativo nunca é tocada.
 */
import { parseAgentKey, type AgentKey } from './agent'
import type { StageFlow } from './task-flow'

export const ORCHESTRATOR_LIMITS = {
  maxActive: 10,
  lanes: 10,
  agentsPerLane: 10
} as const

/** Uma etapa de trabalho dos agentes: quem trabalha nela e para onde a tarefa vai depois. */
export interface OrchestratorLane {
  stageId: string
  /** Agentes que pegam tarefas nesta etapa (o menos ocupado primeiro; empate pela ordem). */
  agents: AgentKey[]
  /** Etapa para onde a tarefa vai quando o fluxo desta etapa termina bem; `null` = fica. */
  next: string | null
}

/** `orkio-config.json` → `orchestrator[projectId]` (v11). */
export interface OrchestratorConfig {
  enabled: boolean
  /**
   * Quando foi ligado (ISO; o main preenche ao salvar). Só fluxos que terminaram depois disso
   * fazem a tarefa seguir: ligar o orquestrador não mexe no que já estava parado no quadro.
   */
  enabledSince: string | null
  /** Coluna de onde o orquestrador puxa tarefas (ex.: "Prioridades"). */
  queueStageId: string | null
  /** Tarefas com agente trabalhando ao mesmo tempo neste projeto (só limita o puxar da fila). */
  maxActive: number
  /** Etapas de trabalho; a primeira recebe as tarefas puxadas da fila. */
  lanes: OrchestratorLane[]
}

export function defaultOrchestrator(): OrchestratorConfig {
  return { enabled: false, enabledSince: null, queueStageId: null, maxActive: 2, lanes: [] }
}

/** Leitura tolerante da config (nunca lança): inválido → `null` (a config cai no padrão). */
export function parseOrchestrator(value: unknown): OrchestratorConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const id = (x: unknown): string | null => (typeof x === 'string' && x ? x.slice(0, 200) : null)
  const maxActive =
    typeof v['maxActive'] === 'number' && Number.isInteger(v['maxActive'])
      ? Math.min(Math.max(v['maxActive'], 1), ORCHESTRATOR_LIMITS.maxActive)
      : defaultOrchestrator().maxActive
  const lanes: OrchestratorLane[] = []
  const seen = new Set<string>()
  if (Array.isArray(v['lanes'])) {
    for (const raw of v['lanes'].slice(0, ORCHESTRATOR_LIMITS.lanes)) {
      if (typeof raw !== 'object' || raw === null) continue
      const r = raw as Record<string, unknown>
      const stageId = id(r['stageId'])
      if (!stageId || seen.has(stageId)) continue
      seen.add(stageId)
      const agents = Array.isArray(r['agents'])
        ? [...new Set(r['agents'].filter((k): k is string => !!parseAgentKey(k)))].slice(
            0,
            ORCHESTRATOR_LIMITS.agentsPerLane
          )
        : []
      lanes.push({ stageId, agents, next: id(r['next']) })
    }
  }
  const since = id(v['enabledSince'])
  return {
    enabled: v['enabled'] === true,
    enabledSince: since && !Number.isNaN(Date.parse(since)) ? since : null,
    queueStageId: id(v['queueStageId']),
    maxActive,
    lanes
  }
}

/**
 * Ponto de partida pelo nome das etapas (template da 3A): fila "Prioridades" → "Em andamento"
 * (Implementador) → "Revisando" (Revisor) → "Revisado". Sem os nomes, usa a ordem do quadro.
 * Vem desligado: você confere e liga.
 */
export function suggestOrchestrator(
  stages: readonly { id: string; name: string }[]
): OrchestratorConfig {
  const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const find = (re: RegExp, fallback: number): string | null =>
    stages.find((s) => re.test(norm(s.name)))?.id ?? stages[fallback]?.id ?? null
  const queue = find(/prioridade|backlog|a fazer|to ?do|fila/, 0)
  const dev = find(/andamento|progress|fazendo|doing|implement/, 1)
  const rev = find(/revisando|review|revisao/, 2)
  const done = find(/revisado|reviewed|aprovad|pronto|finaliz|done/, 3)
  const lanes: OrchestratorLane[] = []
  if (dev && dev !== queue) {
    lanes.push({
      stageId: dev,
      agents: ['builtin:implementador'],
      next: rev && rev !== dev && rev !== queue ? rev : null
    })
  }
  if (rev && rev !== dev && rev !== queue) {
    lanes.push({
      stageId: rev,
      agents: ['builtin:revisor'],
      next: done && ![queue, dev, rev].includes(done) ? done : null
    })
  }
  return { ...defaultOrchestrator(), queueStageId: queue, lanes }
}

// ---------- Validação (editor e main) ----------

export interface OrchestratorAgentInfo {
  key: AgentKey
  name: string
  /** `ready` = pode receber tarefas. */
  status: 'ready' | 'needs_review' | 'invalid' | 'archived' | 'missing'
  /** Mensagem do `checkAgentFlow` para o fluxo ligado à etapa (o agente não poderia rodá-lo). */
  deniedByStage?: Record<string, string>
}

export interface OrchestratorValidation {
  errors: string[]
  warnings: string[]
}

/**
 * Erros bloqueiam salvar (com o orquestrador ligado); avisos explicam o que não vai acontecer.
 * Desligado, só a forma é checada: dá para guardar um rascunho incompleto.
 */
export function validateOrchestrator(
  config: OrchestratorConfig,
  stages: readonly { id: string; name: string }[],
  agents: readonly OrchestratorAgentInfo[],
  bindings: readonly StageFlow[]
): OrchestratorValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const stageName = (id: string | null): string =>
    stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const has = (id: string | null): boolean => !!id && stages.some((s) => s.id === id)
  if (
    !Number.isInteger(config.maxActive) ||
    config.maxActive < 1 ||
    config.maxActive > ORCHESTRATOR_LIMITS.maxActive
  ) {
    errors.push(`Tarefas ao mesmo tempo: de 1 a ${ORCHESTRATOR_LIMITS.maxActive}.`)
  }
  if (config.lanes.length > ORCHESTRATOR_LIMITS.lanes) {
    errors.push(`No máximo ${ORCHESTRATOR_LIMITS.lanes} etapas de trabalho.`)
  }
  if (!config.enabled) return { errors, warnings }

  if (config.lanes.length === 0) errors.push('Adicione ao menos uma etapa de trabalho.')
  const laneIds = new Set<string>()
  for (const [i, lane] of config.lanes.entries()) {
    const label = has(lane.stageId) ? `“${stageName(lane.stageId)}”` : `${i + 1}`
    if (!has(lane.stageId)) errors.push(`A etapa de trabalho ${label} não existe mais no quadro.`)
    if (laneIds.has(lane.stageId)) errors.push(`A etapa ${label} aparece duas vezes.`)
    laneIds.add(lane.stageId)
    if (lane.agents.length === 0) errors.push(`Escolha ao menos um agente para ${label}.`)
    if (lane.agents.length > ORCHESTRATOR_LIMITS.agentsPerLane) {
      errors.push(`No máximo ${ORCHESTRATOR_LIMITS.agentsPerLane} agentes por etapa.`)
    }
    if (lane.next !== null && !has(lane.next)) {
      errors.push(`Depois de ${label}: a etapa escolhida não existe mais.`)
    }
    if (lane.next === lane.stageId) errors.push(`Depois de ${label}: escolha outra etapa.`)
    const bound = bindings.find((b) => b.stageId === lane.stageId && b.enabled)
    if (has(lane.stageId) && (!bound || bound.mode !== 'on_enter')) {
      warnings.push(
        `${label} não tem fluxo que roda ao entrar: os agentes não vão trabalhar nela. Ligue um fluxo em Etapas e automações.`
      )
    }
    for (const key of lane.agents) {
      const a = agents.find((x) => x.key === key)
      if (!a || a.status === 'missing') errors.push(`Um agente de ${label} não existe mais.`)
      else if (a.status === 'invalid') errors.push(`${a.name} tem erros no perfil.`)
      else if (a.status === 'archived') errors.push(`${a.name} está arquivado.`)
      else if (a.status === 'needs_review') {
        warnings.push(`${a.name} precisa de revisão do perfil antes de pegar tarefas.`)
      }
      const denied = a?.deniedByStage?.[lane.stageId]
      if (denied) warnings.push(denied)
    }
  }
  // Ciclo entre etapas de trabalho (A → B → A): roda sem parar enquanto os fluxos terminam bem.
  const nextOf = new Map(config.lanes.map((l) => [l.stageId, l.next]))
  const cycleFrom = config.lanes.find((lane) => {
    const visited = new Set<string>([lane.stageId])
    for (let cur = lane.next; cur && nextOf.has(cur); cur = nextOf.get(cur) ?? null) {
      if (visited.has(cur)) return true
      visited.add(cur)
    }
    return false
  })
  if (cycleFrom) {
    warnings.push(
      `As etapas de trabalho formam um ciclo a partir de “${stageName(cycleFrom.stageId)}”: a tarefa pode girar sem parar.`
    )
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

// ---------- Prioridade ----------

/**
 * Ordem da prioridade do Notion (menor = antes). Reconhece nomes usuais pt/en e P0…P9; número puro
 * vale como está. Sem prioridade ou nome desconhecido vai depois de todas.
 */
export function priorityRank(name: string | null | undefined): number {
  if (!name) return 100
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const p = /^p\s*(\d)\b/.exec(n) ?? /^(\d+)$/.exec(n)
  if (p) return Number(p[1])
  if (/urgent|critic|blocker|imediat|highest/.test(n)) return 0
  if (/alta|high|importante/.test(n)) return 1
  if (/media|medium|normal|moderad/.test(n)) return 2
  if (/baixa|low|minor/.test(n)) return 3
  if (/lowest|minima|someday|talvez/.test(n)) return 4
  return 50
}

// ---------- Decisão de uma rodada ----------

export interface PlanCard {
  taskId: string
  displayId: string
  stageId: string | null
  priority: string | null
  blocked: boolean
  automationPaused: boolean
  /** Posição na lista do Notion (mais recentes primeiro): maior = mais antiga. */
  index: number
}

export interface PlanAgent {
  key: AgentKey
  name: string
  /** Pode receber tarefas (perfil pronto e aprovado). */
  ready: boolean
  /** Fluxos ao mesmo tempo (`limits.parallel`). */
  capacity: number
  /** Limite do dia atingido (mensagem) ou `null`. */
  limitProblem: string | null
}

export interface PlanInput {
  config: OrchestratorConfig
  cards: readonly PlanCard[]
  /** Agente atribuído a cada tarefa e se foi à mão. */
  assignments: ReadonlyMap<string, { key: AgentKey; manual: boolean }>
  agents: ReadonlyMap<AgentKey, PlanAgent>
  /** Fluxos ativos (ou começando) por agente, em todos os projetos. */
  load: ReadonlyMap<AgentKey, number>
  /** Tarefas com fluxo ativo (ou começando): o orquestrador não toca. */
  busy: ReadonlySet<string>
  /** Último fluxo terminou bem DEPOIS de a tarefa entrar na etapa atual (pronta para seguir). */
  finishedHere: ReadonlySet<string>
  /**
   * Último fluxo terminou bem, mas a tarefa entrou na etapa atual enquanto ele rodava (ex.: a PR
   * aberta pelo /pr moveu para "Revisando"): o fluxo desta etapa ainda não rodou.
   */
  carriedIn: ReadonlySet<string>
}

export type PlanDecision =
  | {
      kind: 'handoff'
      taskId: string
      from: string | null
      to: string
      /** Agente para atribuir antes de mover; `null` = a etapa não é de agentes. */
      agent: AgentKey | null
    }
  | { kind: 'start'; taskId: string; stageId: string; agent: AgentKey }
  | { kind: 'wait'; taskId: string; reason: string }

/** O que fazer nesta rodada. Puro e determinístico (mesma entrada, mesmas decisões). */
export function planTick(input: PlanInput): PlanDecision[] {
  const { config } = input
  if (!config.enabled || config.lanes.length === 0) return []
  const lanes = new Map(config.lanes.map((l) => [l.stageId, l]))
  const load = new Map(input.load)
  const out: PlanDecision[] = []
  const usable = (c: PlanCard): boolean =>
    !c.blocked && !c.automationPaused && !input.busy.has(c.taskId)

  const available = (key: AgentKey): boolean => {
    const a = input.agents.get(key)
    return !!a && a.ready && a.limitProblem === null && (load.get(key) ?? 0) < a.capacity
  }
  /** Menos ocupado entre os prontos; com `needFree`, só quem tem vaga agora. */
  const pick = (keys: readonly AgentKey[], needFree: boolean): AgentKey | null => {
    let best: AgentKey | null = null
    let bestScore = Infinity
    for (const key of keys) {
      const a = input.agents.get(key)
      if (!a || !a.ready) continue
      if (needFree && !available(key)) continue
      // Com limite do dia atingido, só como último recurso (o fluxo pausa e você decide).
      const score = (load.get(key) ?? 0) / Math.max(a.capacity, 1) + (a.limitProblem ? 100 : 0)
      if (score < bestScore) {
        best = key
        bestScore = score
      }
    }
    return best
  }
  /** Agente para trabalhar em `lane`: mantém o atual se ele for da etapa. */
  const agentFor = (taskId: string, lane: OrchestratorLane, needFree: boolean): AgentKey | null => {
    const current = input.assignments.get(taskId)
    if (current && lane.agents.includes(current.key)) {
      const a = input.agents.get(current.key)
      if (a?.ready && (!needFree || available(current.key))) return current.key
    }
    return pick(lane.agents, needFree)
  }
  const take = (key: AgentKey | null): void => {
    if (key) load.set(key, (load.get(key) ?? 0) + 1)
  }

  // 1. Trabalho em andamento primeiro: seguir para a próxima etapa ou rodar a etapa atual.
  for (const c of input.cards) {
    if (!c.stageId || !usable(c)) continue
    const lane = lanes.get(c.stageId)
    if (!lane) continue
    if (input.finishedHere.has(c.taskId) && lane.next) {
      const nextLane = lanes.get(lane.next)
      if (!nextLane) {
        out.push({ kind: 'handoff', taskId: c.taskId, from: c.stageId, to: lane.next, agent: null })
        continue
      }
      const agent = agentFor(c.taskId, nextLane, false)
      if (!agent) {
        out.push({
          kind: 'wait',
          taskId: c.taskId,
          reason: 'nenhum agente pronto na próxima etapa'
        })
        continue
      }
      take(agent)
      out.push({ kind: 'handoff', taskId: c.taskId, from: c.stageId, to: lane.next, agent })
    } else if (input.carriedIn.has(c.taskId)) {
      const agent = agentFor(c.taskId, lane, false)
      if (!agent) {
        out.push({ kind: 'wait', taskId: c.taskId, reason: 'nenhum agente pronto nesta etapa' })
        continue
      }
      take(agent)
      out.push({ kind: 'start', taskId: c.taskId, stageId: c.stageId, agent })
    }
  }

  return out
}

/**
 * Agente para uma tarefa que ENTROU numa etapa de trabalho por outro caminho (você, automação da
 * 3B): mantém o atual se ele for da etapa ou se foi escolhido à mão; senão, o menos ocupado.
 * `null` = não mexe.
 */
export function laneAgentOnEnter(
  config: OrchestratorConfig,
  stageId: string,
  current: { key: AgentKey; manual: boolean } | null,
  agents: ReadonlyMap<AgentKey, PlanAgent>,
  load: ReadonlyMap<AgentKey, number>
): AgentKey | null {
  if (!config.enabled) return null
  const lane = config.lanes.find((l) => l.stageId === stageId)
  if (!lane) return null
  if (current && (current.manual || lane.agents.includes(current.key))) return null
  let best: AgentKey | null = null
  let bestScore = Infinity
  for (const key of lane.agents) {
    const a = agents.get(key)
    // Sem informação (primeira rodada ainda não aconteceu): vale a ordem da lista.
    if (a && !a.ready) continue
    const score = a ? (load.get(key) ?? 0) / Math.max(a.capacity, 1) : 0
    if (score < bestScore) {
      best = key
      bestScore = score
    }
  }
  return best
}

/** Rótulos curtos das decisões (histórico e tela). */
export const ORCHESTRATOR_REASONS = {
  /** Só em eventos antigos (o orquestrador puxava da fila). */
  pull: 'puxada da fila',
  handoff: 'fluxo da etapa concluído',
  start: 'entrou na etapa durante a entrega'
} as const

// ---------- Visão para a tela ----------

export interface OrchestratorAgentLoad {
  key: AgentKey
  name: string
  /** Fluxos ativos ou começando (todas as tarefas e projetos). */
  active: number
  capacity: number
  limitProblem: string | null
}

export interface OrchestratorStatus {
  lastRunAt: string | null
  /** Por que a última rodada não aconteceu (ex.: Notion fora). */
  error: string | null
  /** Tarefas deste projeto com agente trabalhando agora. */
  working: number
  /** O que ficou esperando na última rodada (até 20). */
  waiting: { taskId: string; displayId: string; reason: string }[]
  /** Movimentos e inícios feitos na última rodada. */
  lastActions: number
}

export interface OrchestratorState {
  projectId: string
  config: OrchestratorConfig
  validation: OrchestratorValidation
  stages: { id: string; name: string }[]
  /** Etapas com fluxo que roda ao entrar (para o editor avisar). */
  stagesWithFlow: string[]
  agents: OrchestratorAgentLoad[]
  status: OrchestratorStatus
}

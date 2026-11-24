/**
 * Visão geral (Etapa 6D): o que espera você, o que está rodando, PRs que pedem atenção, resumo por
 * projeto, semana e atividade recente, de todos os projetos. Só tipos e agregações puras (main e
 * renderer); o `OverviewService` (main) lê os stores e chama estas funções. Nada de rede.
 */
import type { BoardStage } from './board'
import type { TaskSignals } from './task-signals'
import { FLOW_PAUSE_LABEL, type FlowRunView } from './task-flow'
import type { NotionColor, NotionWorkspaceStatus } from './notion'
import type { ProjectView } from './projects'
import { normalizeLabel } from './text'

/** Seção do painel da tarefa que o clique abre. */
export type TaskSection = 'flow' | 'claude' | 'history'

export interface OverviewTask {
  projectId: string
  projectName: string
  taskId: string
  /** Ex.: "ORK-142"; `null` quando o cache do Notion ainda não tem a tarefa. */
  displayId: string | null
  /** Título do cache em memória do Notion (nunca do disco). */
  title: string | null
}

export type WaitingKind =
  | 'gate'
  | 'action'
  | 'choice'
  | 'decision'
  | 'flow_paused'
  | 'question'
  | 'permission'
  | 'notion_write'

export interface WaitingItem {
  key: string
  kind: WaitingKind
  task: OverviewTask
  /** O que falta, curto (pt-BR). */
  what: string
  since: string
  section: TaskSection
}

export interface RunningItem {
  key: string
  kind: 'run' | 'flow'
  task: OverviewTask
  /** Ex.: "Alva: implementar · /alva-flow:review" ou "Claude Code · /revisar". */
  label: string
  state: 'running' | 'queued'
  startedAt: string
  section: TaskSection
}

export type PrReason = 'ci_failed' | 'changes_requested' | 'unresolved_comments' | 'stale_review'

export interface PrAttentionItem {
  key: string
  task: OverviewTask
  number: number
  url: string
  reasons: PrReason[]
  /** Comentários não resolvidos (quando é um dos motivos). */
  unresolved: number | null
  /** Dias aberta (quando `stale_review`). */
  openDays: number | null
}

export type HealthLevel = 'ok' | 'warning' | 'problem' | 'off'

export interface ProjectHealthSummary {
  folder: HealthLevel
  github: HealthLevel
  notion: HealthLevel
  /** Primeira explicação de problema (pasta/GitHub/Notion), quando houver. */
  message: string | null
}

export interface ProjectCardView {
  projectId: string
  name: string
  stages: { id: string; name: string; color: NotionColor | null; count: number }[]
  noStage: number
  total: number
  blocked: number
  health: ProjectHealthSummary
  /** Automações pausadas para todos os projetos ("Pausar todas"). */
  automationsPaused: boolean
  /** Tarefas com automação pausada neste projeto. */
  pausedTasks: number
  waiting: number
  /** Tem quadro configurado (sem quadro: só saúde). */
  hasBoard: boolean
}

export interface WeekStats {
  since: string
  finished: number
  /** `null` = nenhum projeto com dados do GitHub em cache. */
  prsOpened: number | null
  prsMerged: number | null
  cost: { usd: number; known: number; total: number }
  /** Tempo médio em "Revisado" (ms) de quem saiu da etapa na semana; `null` sem amostras. */
  reviewAvgMs: number | null
  reviewSamples: number
}

export interface OverviewSnapshot {
  generatedAt: string
  waiting: WaitingItem[]
  running: RunningItem[]
  prs: PrAttentionItem[]
  projects: ProjectCardView[]
  week: WeekStats
  /** Avisos curtos (ex.: projeto sem dados do GitHub ainda). */
  notices: string[]
}

export type ActivityGroup = 'board' | 'automation' | 'claude' | 'flow' | 'delivery' | 'notion'

export const ACTIVITY_GROUP_LABEL: Record<ActivityGroup, string> = {
  board: 'Quadro',
  automation: 'Automações',
  claude: 'Claude Code',
  flow: 'Fluxos',
  delivery: 'Entrega',
  notion: 'Notion'
}

export interface ActivityItem {
  id: number
  at: string
  group: ActivityGroup
  task: OverviewTask
  text: string
  /** Link do GitHub (PR ou branch), já dentro da allowlist. */
  link: string | null
  section: TaskSection
}

export interface ActivityQuery {
  projectId?: string | null
  group?: ActivityGroup | null
  /** Paginação: eventos com id menor que este. */
  beforeId?: number | null
  limit?: number
}

export interface ActivityPage {
  items: ActivityItem[]
  hasMore: boolean
}

/** PR aberta sem nenhum review há mais que isto entra em "PRs que precisam de atenção". */
export const STALE_REVIEW_DAYS = 3
/** Janela da atividade recente e da semana. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
/** Escrita recusada pelo Notion fica em "Esperando você" por até 24 h (ou até mexer na tarefa). */
export const NOTION_REJECT_WINDOW_MS = 24 * 60 * 60 * 1000
/** Escrita pendente com erro a partir desta tentativa entra em "Esperando você". */
export const NOTION_PENDING_ATTEMPTS = 3

const DAY_MS = 24 * 60 * 60 * 1000

// ---------- Esperando você ----------

function stepName(flow: FlowRunView): string | null {
  const step = flow.steps.find((s) => s.id === flow.currentStep)
  return step ? step.name || step.id : null
}

/**
 * Gate com mensagem curta (uma linha, até 60 caracteres, já com as variáveis): ela é o título do
 * item (ex.: "Aprovar correções da PR #13"). Mensagens longas são instruções: fica o nome do passo.
 */
function gateTitle(flow: FlowRunView): string | null {
  const step = flow.steps.find((s) => s.id === flow.currentStep)
  if (step?.type !== 'gate') return null
  const message = step.message.trim()
  return message && message.length <= 60 && !message.includes('\n') ? message : null
}

/** Desde quando o fluxo está no estado atual: início do último passo registrado. */
function flowSince(flow: FlowRunView): string {
  return flow.history[flow.history.length - 1]?.startedAt ?? flow.startedAt
}

/** Fluxo ativo que espera você (gate, ação, escolha, pausa, saída da etapa); `null` se não. */
export function flowWaitingItem(flow: FlowRunView, task: OverviewTask): WaitingItem | null {
  const base = { key: `flow:${flow.id}`, task, since: flowSince(flow), section: 'flow' as const }
  const step = stepName(flow)
  switch (flow.status) {
    case 'waiting_gate':
      return flow.confirm
        ? { ...base, kind: 'action', what: `Aprovar: ${flow.confirm.title}` }
        : {
            ...base,
            kind: 'gate',
            what: gateTitle(flow) ?? `Aprovação no fluxo${step ? `: ${step}` : ''}`
          }
    case 'awaiting_decision':
      return {
        ...base,
        kind: 'decision',
        what: 'A tarefa saiu da etapa: cancelar o fluxo ou deixar terminar?'
      }
    case 'paused':
      if (flow.pauseReason === 'waiting_slot') return null
      if (flow.pauseReason === 'needs_choice') {
        return {
          ...base,
          kind: 'choice',
          what: flow.choice?.prompt ?? FLOW_PAUSE_LABEL.needs_choice
        }
      }
      return {
        ...base,
        kind: 'flow_paused',
        what: `${flow.pauseReason ? FLOW_PAUSE_LABEL[flow.pauseReason] : 'Fluxo pausado'}${step ? ` (${step})` : ''}`
      }
    default:
      return null
  }
}

export interface PendingRequest {
  runId: string
  requestId: string
  kind: 'question' | 'permission'
  summary: string
  since: string
}

export function requestWaitingItem(req: PendingRequest, task: OverviewTask): WaitingItem {
  return {
    key: `req:${req.runId}:${req.requestId}`,
    kind: req.kind,
    task,
    what:
      req.kind === 'question'
        ? `Pergunta do Claude Code: ${req.summary}`
        : `Permissão para o Claude Code: ${req.summary}`,
    since: req.since,
    section: 'claude'
  }
}

const NOTION_ERROR_LABEL: Record<string, string> = {
  forbidden: 'a integração não pode editar esta página',
  not_found: 'página não encontrada',
  bad_request: 'o Notion recusou o valor',
  unauthorized: 'reconecte o Notion'
}

/** Mudança recusada pelo Notion (voltou no quadro) ou presa tentando de novo. */
export function notionWaitingItem(
  input:
    | { type: 'rejected'; eventId: number; code: string | null; at: string }
    | { type: 'retrying'; writeId: number; attempts: number; since: string },
  task: OverviewTask
): WaitingItem {
  if (input.type === 'rejected') {
    const why = input.code ? NOTION_ERROR_LABEL[input.code] : undefined
    return {
      key: `notion:rejected:${input.eventId}`,
      kind: 'notion_write',
      task,
      what: `O Notion recusou a mudança e o card voltou${why ? ` (${why})` : ''}`,
      since: input.at,
      section: 'history'
    }
  }
  return {
    key: `notion:pending:${input.writeId}`,
    kind: 'notion_write',
    task,
    what: `Mudança ainda não chegou ao Notion (${input.attempts} tentativas)`,
    since: input.since,
    section: 'history'
  }
}

/** Mais antigo primeiro (quem espera há mais tempo). */
export function sortWaiting(items: WaitingItem[]): WaitingItem[] {
  return [...items].sort((a, b) => a.since.localeCompare(b.since) || a.key.localeCompare(b.key))
}

// ---------- Em execução ----------

export interface ActiveRunInput {
  runId: string
  projectId: string
  taskId: string
  state: 'running' | 'queued'
  startedAt: string
  command: string | null
}

/**
 * Execuções do Claude Code e fluxos rodando. Uma execução que é passo de um fluxo aparece uma vez,
 * como o fluxo (com o passo atual).
 */
export function buildRunning(
  runs: readonly ActiveRunInput[],
  flows: readonly FlowRunView[],
  task: (projectId: string, taskId: string) => OverviewTask
): RunningItem[] {
  const items: RunningItem[] = []
  const flowRunIds = new Set<string>()
  for (const flow of flows) {
    const running = flow.status === 'running'
    const waitingSlot = flow.status === 'paused' && flow.pauseReason === 'waiting_slot'
    if (!running && !waitingSlot) continue
    const current = flow.history[flow.history.length - 1]
    if (current?.runId) flowRunIds.add(current.runId)
    const step = flow.steps.find((s) => s.id === flow.currentStep)
    const stepLabel = step
      ? step.type === 'claude_command' && step.command
        ? `/${step.command}`
        : step.name || step.id
      : null
    items.push({
      key: `flow:${flow.id}`,
      kind: 'flow',
      task: task(flow.projectId, flow.taskId),
      label: waitingSlot
        ? `${flow.flowName} · aguardando vaga`
        : `${flow.flowName}${stepLabel ? ` · ${stepLabel}` : ''}`,
      state: waitingSlot ? 'queued' : 'running',
      startedAt: flow.startedAt,
      section: 'flow'
    })
  }
  for (const run of runs) {
    if (flowRunIds.has(run.runId)) continue
    items.push({
      key: `run:${run.runId}`,
      kind: 'run',
      task: task(run.projectId, run.taskId),
      label: `Claude Code · ${run.command ? `/${run.command}` : 'prompt'}`,
      state: run.state,
      startedAt: run.startedAt,
      section: 'claude'
    })
  }
  return items.sort(
    (a, b) =>
      Number(a.state === 'queued') - Number(b.state === 'queued') ||
      a.startedAt.localeCompare(b.startedAt)
  )
}

// ---------- PRs ----------

const PR_RANK: Record<PrReason, number> = {
  ci_failed: 0,
  changes_requested: 1,
  unresolved_comments: 2,
  stale_review: 3
}

/** PRs abertas ligadas a tarefas que pedem atenção (CI vermelho, mudanças pedidas...). */
export function prAttention(
  signals: Readonly<Record<string, TaskSignals>>,
  task: (taskId: string) => OverviewTask,
  now: Date,
  staleDays = STALE_REVIEW_DAYS
): PrAttentionItem[] {
  const items: PrAttentionItem[] = []
  for (const s of Object.values(signals)) {
    const pr = s.pr
    if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) continue
    const reasons: PrReason[] = []
    if (pr.checks === 'failure') reasons.push('ci_failed')
    if (pr.reviewDecision === 'changes_requested') reasons.push('changes_requested')
    const unresolved = pr.unresolvedComments ?? 0
    if (unresolved > 0) reasons.push('unresolved_comments')
    let openDays: number | null = null
    if (pr.state === 'open' && pr.createdAt) {
      const days = Math.floor((now.getTime() - Date.parse(pr.createdAt)) / DAY_MS)
      const reviewed = (pr.reviews?.length ?? 0) > 0 || pr.reviewDecision === 'approved'
      if (days >= staleDays && !reviewed && pr.reviewDecision !== 'changes_requested') {
        reasons.push('stale_review')
        openDays = days
      }
    }
    if (reasons.length === 0) continue
    const t = task(s.taskId)
    items.push({
      key: `pr:${t.projectId}:${pr.number}`,
      task: t,
      number: pr.number,
      url: pr.url,
      reasons,
      unresolved: unresolved > 0 ? unresolved : null,
      openDays
    })
  }
  return items.sort(
    (a, b) =>
      PR_RANK[a.reasons[0]!] - PR_RANK[b.reasons[0]!] ||
      a.task.projectId.localeCompare(b.task.projectId) ||
      a.number - b.number
  )
}

export const PR_REASON_LABEL: Record<PrReason, string> = {
  ci_failed: 'CI vermelho',
  changes_requested: 'Mudanças pedidas',
  unresolved_comments: 'Comentários não resolvidos',
  stale_review: 'Sem review'
}

// ---------- Por projeto ----------

const FOLDER_PROBLEMS = new Set(['missing_folder', 'not_a_repo', 'repo_mismatch', 'git_error'])
const GITHUB_WARNINGS = new Set(['github_disconnected', 'no_access', 'unverified'])

export function projectHealth(
  project: Pick<ProjectView, 'health' | 'repo' | 'notionProject'>,
  notion: NotionWorkspaceStatus['health'] | null
): ProjectHealthSummary {
  const state = project.health.state
  const folder: HealthLevel = FOLDER_PROBLEMS.has(state) ? 'problem' : 'ok'
  const github: HealthLevel = !project.repo
    ? 'off'
    : folder === 'problem'
      ? 'warning'
      : GITHUB_WARNINGS.has(state)
        ? 'warning'
        : 'ok'
  const notionLevel: HealthLevel = !project.notionProject
    ? 'off'
    : notion === 'broken'
      ? 'problem'
      : notion === 'ok'
        ? 'ok'
        : 'warning'
  const message =
    state !== 'ok' && state !== 'checking'
      ? (project.health.message ?? null)
      : notionLevel === 'problem'
        ? 'O mapeamento do Notion está quebrado: revise em Integrações.'
        : null
  return { folder, github, notion: notionLevel, message }
}

export function projectCard(input: {
  project: Pick<ProjectView, 'id' | 'name' | 'health' | 'repo' | 'notionProject'>
  stages: readonly BoardStage[] | null
  states: readonly { stageId: string | null; blocked: boolean; automationPaused: boolean }[]
  notionHealth: NotionWorkspaceStatus['health'] | null
  automationsPaused: boolean
  waiting: number
}): ProjectCardView {
  const stages = [...(input.stages ?? [])].sort((a, b) => a.order - b.order)
  const counts = new Map(stages.map((s) => [s.id, 0]))
  let noStage = 0
  for (const s of input.states) {
    if (s.stageId && counts.has(s.stageId)) counts.set(s.stageId, counts.get(s.stageId)! + 1)
    else noStage++
  }
  return {
    projectId: input.project.id,
    name: input.project.name,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color ?? null,
      count: counts.get(s.id) ?? 0
    })),
    noStage,
    total: input.states.length,
    blocked: input.states.filter((s) => s.blocked).length,
    health: projectHealth(input.project, input.notionHealth),
    automationsPaused: input.automationsPaused,
    pausedTasks: input.states.filter((s) => s.automationPaused).length,
    waiting: input.waiting,
    hasBoard: input.stages !== null
  }
}

// ---------- Semana ----------

export interface StageEventInput {
  id: number
  taskPageId: string
  projectId: string
  at: string
  kind: string
  fromStage: string | null
  toStage: string | null
}

/** Eventos que mudam a etapa de uma tarefa. */
export const STAGE_EVENT_KINDS = ['added', 'moved', 'reconciled', 'rolled_back'] as const

/** Tarefas distintas que entraram na última etapa do quadro desde `since`. */
export function finishedCount(
  events: readonly StageEventInput[],
  finalStage: ReadonlyMap<string, string>,
  since: string
): number {
  const done = new Set<string>()
  for (const e of events) {
    if (e.at < since || e.kind === 'added') continue
    const target = finalStage.get(e.projectId)
    if (target && e.toStage === target && e.fromStage !== target) done.add(e.taskPageId)
  }
  return done.size
}

/**
 * Tempo médio na etapa de revisão (ex.: "Revisado"): pares entrada → saída, contando só as saídas
 * desde `since`. Retrabalho aparece como várias passagens pela etapa.
 */
export function stageDwell(
  events: readonly StageEventInput[],
  stageByProject: ReadonlyMap<string, string>,
  since: string
): { avgMs: number | null; samples: number } {
  const entered = new Map<string, string>()
  const durations: number[] = []
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (!(STAGE_EVENT_KINDS as readonly string[]).includes(e.kind)) continue
    const stage = stageByProject.get(e.projectId)
    if (!stage) continue
    if (e.toStage === stage && e.fromStage !== stage) {
      entered.set(e.taskPageId, e.at)
    } else if (e.fromStage === stage && e.toStage !== stage) {
      const start = entered.get(e.taskPageId)
      entered.delete(e.taskPageId)
      if (start && e.at >= since) durations.push(Date.parse(e.at) - Date.parse(start))
    }
  }
  return {
    avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    samples: durations.length
  }
}

/** Etapa de revisão do projeto: a chamada "Revisado" (do template), sem acento/caixa. */
export function reviewStageId(stages: readonly BoardStage[]): string | null {
  return stages.find((s) => normalizeLabel(s.name) === 'revisado')?.id ?? null
}

/** Última etapa do quadro (maior `order`). */
export function finalStageId(stages: readonly BoardStage[]): string | null {
  return [...stages].sort((a, b) => b.order - a.order)[0]?.id ?? null
}

export function pullsInWeek(
  pullsByProject: readonly (
    readonly { createdAt?: string | null; merged: boolean; closedAt?: string | null }[] | null
  )[],
  since: string
): { opened: number | null; merged: number | null } {
  const known = pullsByProject.filter(
    (p): p is readonly { createdAt?: string | null; merged: boolean; closedAt?: string | null }[] =>
      p !== null
  )
  if (known.length === 0) return { opened: null, merged: null }
  let opened = 0
  let merged = 0
  for (const pulls of known) {
    for (const p of pulls) {
      if (p.createdAt && p.createdAt >= since) opened++
      if (p.merged && p.closedAt && p.closedAt >= since) merged++
    }
  }
  return { opened, merged }
}

export function costSum(runs: readonly { cost: number | null }[]): WeekStats['cost'] {
  const known = runs.filter((r): r is { cost: number } => typeof r.cost === 'number')
  return {
    usd: known.reduce((a, r) => a + r.cost, 0),
    known: known.length,
    total: runs.length
  }
}

// ---------- Atividade ----------

/** Tipos de evento de cada grupo da atividade (`sync_ok` fica de fora: é ruído). */
export const ACTIVITY_KINDS: Record<ActivityGroup, readonly string[]> = {
  board: [
    'added',
    'moved',
    'reconciled',
    'blocked',
    'unblocked',
    'automation_paused',
    'automation_resumed',
    'agent_assigned',
    'agent_unassigned'
  ],
  automation: ['automation', 'moved'],
  claude: [
    'run_started',
    'run_finished',
    'run_cancelled',
    'run_failed',
    'run_blocked',
    'artifact_attached',
    'artifact_published'
  ],
  flow: [
    'flow_started',
    'step_started',
    'step_finished',
    'step_failed',
    'step_skipped',
    'gate_waiting',
    'gate_approved',
    'gate_rejected',
    'gate_revised',
    'flow_paused',
    'flow_finished'
  ],
  delivery: ['delivery'],
  notion: ['sync_failed', 'rolled_back']
}

/** Grupo de um evento (`null` = fica fora da atividade). */
export function activityGroup(e: {
  kind: string
  source: string
  detail: Record<string, unknown> | null
}): ActivityGroup | null {
  if (e.kind === 'moved') return e.source === 'automation' ? 'automation' : 'board'
  if (e.kind === 'automation') return e.detail?.['outcome'] === 'noop' ? null : 'automation'
  for (const [group, kinds] of Object.entries(ACTIVITY_KINDS) as [
    ActivityGroup,
    readonly string[]
  ][]) {
    if (kinds.includes(e.kind)) return group
  }
  return null
}

export function activitySection(group: ActivityGroup): TaskSection {
  return group === 'claude'
    ? 'claude'
    : group === 'flow' || group === 'delivery'
      ? 'flow'
      : 'history'
}

// ---------- Formatação ----------

/** "agora", "há 5 min", "há 2 h", "há 3 d". */
export function formatAgo(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(iso))
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/** "45 s", "12 min", "1 h 05 min", "1,8 d". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')} min`
  return `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d`
}

/** Rótulo curto da tarefa: "ORK-142 Exportar CSV" ou o que houver. */
export function taskLabel(task: Pick<OverviewTask, 'displayId' | 'title'>): string {
  return [task.displayId, task.title].filter(Boolean).join(' ') || 'Tarefa do Notion'
}

export interface BoardTaskRef {
  projectId: string
  taskId: string
  /** Seção do painel da tarefa a mostrar (Visão geral, 6D). */
  section?: TaskSection
}

/**
 * Kanban derivado pessoal (Fase 1): em que pé está cada tarefa em que o Orkio mexeu, calculado do
 * estado dos fluxos, das execuções e da PR. Não há estado manual: mover o card continua sendo no
 * quadro do Notion (o do time). Puro (main e renderer); o `OverviewService` junta as entradas.
 */
import type { StageRole } from './board'
import { finalText, isUnfinishedResult, type FlowResult } from './flow-final'
import type { OverviewTask, RunningItem, WaitingItem } from './overview'
import type { TaskPullRequest } from './task-signals'

export const TASK_LANES = ['needs_you', 'working', 'waiting', 'in_review', 'done'] as const
export type TaskLane = (typeof TASK_LANES)[number]

export const TASK_LANE_TEXT: Record<TaskLane, { label: string; empty: string }> = {
  needs_you: { label: 'Precisa de você', empty: 'Nada espera você' },
  working: { label: 'Trabalhando', empty: 'Nenhum agente trabalhando' },
  waiting: { label: 'Aguardando', empty: 'Nada aguardando' },
  in_review: { label: 'Em revisão', empty: 'Nenhuma PR aberta' },
  done: { label: 'Concluído', empty: 'Nada concluído nos últimos 7 dias' }
}

export type PrChip =
  'ci_failed' | 'changes_requested' | 'conflict' | 'comments' | 'ready' | 'awaiting_review'

export const PR_CHIP_TEXT: Record<PrChip, { label: string; attention: boolean }> = {
  ci_failed: { label: 'CI falhando', attention: true },
  changes_requested: { label: 'Mudanças pedidas', attention: true },
  conflict: { label: 'Conflito', attention: true },
  comments: { label: 'Comentários', attention: false },
  ready: { label: 'Pronta', attention: false },
  awaiting_review: { label: 'Esperando review', attention: false }
}

export interface PersonalTask {
  task: OverviewTask
  lane: TaskLane
  /** O quê, curto: o que espera você, o passo rodando, o que se aguarda, a PR. */
  what: string
  chips: PrChip[]
  pr: { number: number; url: string } | null
  /** Desde quando está assim (para ordenar). */
  since: string
}

export interface LaneInput {
  task: OverviewTask
  waiting: WaitingItem | null
  running: RunningItem | null
  pr: TaskPullRequest | null
  stageRole: StageRole | null
  /** Último fluxo terminado (o ativo entra por `waiting`/`running`). */
  lastFlow: { result: FlowResult | null; endedAt: string | null } | null
  now: string
}

/** A PR conta como concluída nesta janela depois do merge. */
export const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function prChips(pr: TaskPullRequest): PrChip[] {
  const chips: PrChip[] = []
  if (pr.checks === 'failure') chips.push('ci_failed')
  if (pr.reviewDecision === 'changes_requested') chips.push('changes_requested')
  if (pr.conflict === true) chips.push('conflict')
  if ((pr.unresolvedComments ?? 0) > 0) chips.push('comments')
  if (chips.length === 0) {
    const green = pr.checks === 'success' || pr.checks === null
    chips.push(pr.reviewDecision === 'approved' && green ? 'ready' : 'awaiting_review')
  }
  return chips
}

function recent(at: string | null | undefined, now: string): boolean {
  return !!at && Date.parse(now) - Date.parse(at) <= DONE_WINDOW_MS
}

/**
 * Raia da tarefa, na ordem: espera você → trabalhando → na fila → PR (CI rodando ou rascunho =
 * aguardando; aberta = em revisão; mergeada = concluída) → coluna concluída → fluxo terminado há
 * pouco. `null` = nada recente para mostrar.
 */
export function deriveLane(input: LaneInput): PersonalTask | null {
  const { task, waiting, running, pr, now } = input
  const prRef = pr ? { number: pr.number, url: pr.url } : null
  const base = { task, pr: prRef }
  if (waiting) {
    return { ...base, lane: 'needs_you', what: waiting.what, chips: [], since: waiting.since }
  }
  if (running?.state === 'running') {
    return { ...base, lane: 'working', what: running.label, chips: [], since: running.startedAt }
  }
  if (running) {
    return { ...base, lane: 'waiting', what: running.label, chips: [], since: running.startedAt }
  }
  if (pr && (pr.state === 'open' || pr.state === 'draft')) {
    const since = pr.updatedAt
    if (pr.state === 'draft') {
      return { ...base, lane: 'waiting', what: `PR #${pr.number} em rascunho`, chips: [], since }
    }
    if (pr.checks === 'pending') {
      return { ...base, lane: 'waiting', what: `CI rodando na PR #${pr.number}`, chips: [], since }
    }
    return { ...base, lane: 'in_review', what: `PR #${pr.number}`, chips: prChips(pr), since }
  }
  if (pr?.state === 'merged' && recent(pr.closedAt ?? pr.updatedAt, now)) {
    return {
      ...base,
      lane: 'done',
      what: `PR #${pr.number} mergeada`,
      chips: [],
      since: pr.closedAt ?? pr.updatedAt
    }
  }
  const last = input.lastFlow
  if (input.stageRole === 'done' && (recent(last?.endedAt, now) || pr?.state === 'merged')) {
    return {
      ...base,
      lane: 'done',
      what: 'Na coluna concluída',
      chips: [],
      since: last?.endedAt ?? now
    }
  }
  if (last && recent(last.endedAt, now)) {
    // Final honesto: esgotado, travado, bloqueado ou falhou não é "concluído"; alguém precisa olhar.
    if (isUnfinishedResult(last.result)) {
      const t = finalText(last.result)
      return {
        ...base,
        lane: 'needs_you',
        what: `Fluxo ${t.label.toLowerCase()}`,
        chips: [],
        since: last.endedAt!
      }
    }
    const what =
      last.result === 'rejected'
        ? 'Recusado por você'
        : last.result === 'cancelled'
          ? 'Fluxo cancelado'
          : last.result === 'nothing'
            ? 'Nada a fazer'
            : 'Fluxo concluído'
    return { ...base, lane: 'done', what, chips: [], since: last.endedAt! }
  }
  return null
}

export const TASK_FILTERS = ['all', 'attention', 'active', 'review'] as const
export type TaskFilter = (typeof TASK_FILTERS)[number]

export const TASK_FILTER_TEXT: Record<TaskFilter, string> = {
  all: 'Todas',
  attention: 'Precisa de você',
  active: 'Em andamento',
  review: 'Em revisão'
}

/** Precisa de atenção: espera você ou PR com CI falhando, mudanças pedidas ou conflito. */
export function needsAttention(t: PersonalTask): boolean {
  return t.lane === 'needs_you' || t.chips.some((c) => PR_CHIP_TEXT[c].attention)
}

/** `null` (card sem tarefa pessoal) só passa em "Todas". */
export function matchesTaskFilter(t: PersonalTask | null, filter: TaskFilter): boolean {
  if (filter === 'all') return true
  if (!t) return false
  if (filter === 'attention') return needsAttention(t)
  if (filter === 'active') return t.lane === 'working' || t.lane === 'waiting'
  return t.lane === 'in_review'
}

export function filterTasks(
  tasks: readonly PersonalTask[],
  filter: TaskFilter,
  query = ''
): PersonalTask[] {
  const q = query.trim().toLowerCase()
  return tasks.filter((t) => {
    if (!matchesTaskFilter(t, filter)) return false
    if (!q) return true
    return [t.task.displayId, t.task.title, t.task.projectName, t.what].some((x) =>
      x?.toLowerCase().includes(q)
    )
  })
}

/** Por raia, na ordem das raias; dentro, o mais antigo primeiro (quem espera há mais tempo). */
export function groupByLane(tasks: readonly PersonalTask[]): Record<TaskLane, PersonalTask[]> {
  const out = Object.fromEntries(TASK_LANES.map((l) => [l, [] as PersonalTask[]])) as Record<
    TaskLane,
    PersonalTask[]
  >
  for (const t of tasks) out[t.lane].push(t)
  for (const lane of TASK_LANES) {
    out[lane].sort((a, b) =>
      lane === 'done' ? b.since.localeCompare(a.since) : a.since.localeCompare(b.since)
    )
  }
  return out
}

export interface PersonalTasksSnapshot {
  generatedAt: string
  tasks: PersonalTask[]
}

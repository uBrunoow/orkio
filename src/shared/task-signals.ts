/**
 * Sinais de uma tarefa (branch local/remota, PR) calculados a partir do git local e do GitHub.
 * Base das automações da Etapa 3: aqui só calculamos (`buildTaskSignals`) e comparamos
 * (`diffSignals`). Funções puras, sem Node/DOM.
 */
import { extractTaskNumbers, parseDisplayId } from './task-id-match'

export type PullRequestState = 'draft' | 'open' | 'merged' | 'closed'
export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required'
export type ChecksState = 'success' | 'failure' | 'pending'

export interface PullRequestSummary {
  number: number
  title: string
  url: string
  state: PullRequestState
  merged: boolean
  headRef: string
  updatedAt: string
  /** Quando foi fechada/mergeada (REST `closed_at`); `null` se aberta. */
  closedAt?: string | null
}

/** Detalhes que vêm do GraphQL (podem faltar: sem permissão, falha, ainda não carregados). */
export interface PullRequestDetails {
  reviewDecision: ReviewDecision | null
  /** Threads de review não resolvidas; `null` = indisponível. */
  unresolvedComments: number | null
  checks: ChecksState | null
  /** Pedidos de review (ids do GitHub, inclusive re-pedidos). Só para automações (3B). */
  reviewRequests?: { id: string; at: string }[]
  /** Reviews com decisão (APPROVED / CHANGES_REQUESTED). */
  reviews?: { id: string; state: 'approved' | 'changes_requested'; at: string }[]
  /** Ids das threads de review não resolvidas. */
  unresolvedThreadIds?: string[]
}

export interface TaskPullRequest extends PullRequestSummary, PullRequestDetails {}

export interface TaskSignals {
  taskId: string
  displayId: string
  localBranches: string[]
  remoteBranches: string[]
  pr: TaskPullRequest | null
  /** Outras PRs que também citam a tarefa (além da principal). */
  otherPrs: number
}

export interface SignalSources {
  localBranches: readonly string[]
  /** `null` = indisponível (sem GitHub, sem acesso...). */
  remoteBranches: readonly string[] | null
  pulls: readonly PullRequestSummary[] | null
  details: ReadonlyMap<number, PullRequestDetails>
}

const STATE_RANK: Record<PullRequestState, number> = { open: 0, draft: 1, merged: 2, closed: 3 }

/** Principal: aberta > rascunho > mergeada > fechada; empate → atualizada mais recentemente. */
export function comparePulls(a: PullRequestSummary, b: PullRequestSummary): number {
  return (
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.number - a.number
  )
}

/** Indexa nomes por número de tarefa (uma passada por fonte, não por tarefa). */
function indexBy<T>(items: readonly T[], texts: (item: T) => string[], prefix: string) {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const numbers = new Set(texts(item).flatMap((t) => extractTaskNumbers(t, prefix)))
    for (const n of numbers) {
      const list = map.get(n) ?? []
      list.push(item)
      map.set(n, list)
    }
  }
  return map
}

/**
 * Sinais de cada tarefa. Tarefas sem prefixo no ID (só número) não recebem sinais: casar um
 * número solto em nomes de branch seria arriscado.
 */
export function buildTaskSignals(
  tasks: readonly { id: string; displayId: string | null }[],
  sources: SignalSources
): Record<string, TaskSignals> {
  const result: Record<string, TaskSignals> = {}
  const byPrefix = new Map<
    string,
    {
      local: Map<number, string[]>
      remote: Map<number, string[]>
      pulls: Map<number, PullRequestSummary[]>
    }
  >()

  for (const task of tasks) {
    const parsed = parseDisplayId(task.displayId)
    if (!parsed || !task.displayId) continue
    const key = parsed.prefix.toLowerCase()
    let index = byPrefix.get(key)
    if (!index) {
      index = {
        local: indexBy(sources.localBranches, (b) => [b], parsed.prefix),
        remote: indexBy(sources.remoteBranches ?? [], (b) => [b], parsed.prefix),
        pulls: indexBy(sources.pulls ?? [], (p) => [p.title, p.headRef], parsed.prefix)
      }
      byPrefix.set(key, index)
    }
    const pulls = [...(index.pulls.get(parsed.number) ?? [])].sort(comparePulls)
    const main = pulls[0]
    const details = main ? sources.details.get(main.number) : undefined
    result[task.id] = {
      taskId: task.id,
      displayId: task.displayId,
      localBranches: [...(index.local.get(parsed.number) ?? [])].sort(),
      remoteBranches: [...(index.remote.get(parsed.number) ?? [])].sort(),
      pr: main
        ? {
            ...main,
            reviewDecision: details?.reviewDecision ?? null,
            unresolvedComments: details?.unresolvedComments ?? null,
            checks: details?.checks ?? null,
            ...(details?.reviewRequests ? { reviewRequests: details.reviewRequests } : {}),
            ...(details?.reviews ? { reviews: details.reviews } : {}),
            ...(details?.unresolvedThreadIds
              ? { unresolvedThreadIds: details.unresolvedThreadIds }
              : {})
          }
        : null,
      otherPrs: Math.max(0, pulls.length - 1)
    }
  }
  return result
}

export type SignalEvent =
  | { kind: 'branch_created'; taskId: string; branch: string; where: 'local' | 'remote' }
  | { kind: 'branch_deleted'; taskId: string; branch: string; where: 'local' | 'remote' }
  | { kind: 'pr_opened'; taskId: string; number: number; draft: boolean }
  | { kind: 'pr_ready_for_review'; taskId: string; number: number }
  | { kind: 'pr_merged'; taskId: string; number: number }
  | { kind: 'pr_closed'; taskId: string; number: number }
  | { kind: 'pr_reopened'; taskId: string; number: number }
  | {
      kind: 'review_changed'
      taskId: string
      number: number
      from: ReviewDecision | null
      to: ReviewDecision | null
    }
  | {
      kind: 'checks_changed'
      taskId: string
      number: number
      from: ChecksState | null
      to: ChecksState | null
    }

/**
 * Eventos entre dois cálculos de sinais (base da Etapa 3; ainda não usado por automações).
 * Tarefas ausentes em `before` não geram eventos (primeira observação não é mudança).
 */
export function diffSignals(
  before: Readonly<Record<string, TaskSignals>>,
  after: Readonly<Record<string, TaskSignals>>
): SignalEvent[] {
  const events: SignalEvent[] = []
  for (const [taskId, next] of Object.entries(after)) {
    const prev = before[taskId]
    if (!prev) continue
    for (const where of ['local', 'remote'] as const) {
      const a = new Set(where === 'local' ? prev.localBranches : prev.remoteBranches)
      const b = new Set(where === 'local' ? next.localBranches : next.remoteBranches)
      for (const branch of b)
        if (!a.has(branch)) events.push({ kind: 'branch_created', taskId, branch, where })
      for (const branch of a)
        if (!b.has(branch)) events.push({ kind: 'branch_deleted', taskId, branch, where })
    }
    const p = prev.pr
    const n = next.pr
    if (!n) continue
    if (!p || p.number !== n.number) {
      if (n.state === 'open' || n.state === 'draft') {
        events.push({ kind: 'pr_opened', taskId, number: n.number, draft: n.state === 'draft' })
      } else if (n.state === 'merged') {
        events.push({ kind: 'pr_merged', taskId, number: n.number })
      }
      continue
    }
    if (p.state !== n.state) {
      if (n.state === 'merged') events.push({ kind: 'pr_merged', taskId, number: n.number })
      else if (n.state === 'closed') events.push({ kind: 'pr_closed', taskId, number: n.number })
      else if (p.state === 'draft' && n.state === 'open') {
        events.push({ kind: 'pr_ready_for_review', taskId, number: n.number })
      } else if (p.state === 'closed' || p.state === 'merged') {
        events.push({ kind: 'pr_reopened', taskId, number: n.number })
      }
    }
    // Só compara detalhes conhecidos dos dois lados (null = indisponível, não "mudou").
    if (
      p.reviewDecision !== n.reviewDecision &&
      p.reviewDecision !== null &&
      n.reviewDecision !== null
    ) {
      events.push({
        kind: 'review_changed',
        taskId,
        number: n.number,
        from: p.reviewDecision,
        to: n.reviewDecision
      })
    }
    if (p.checks !== n.checks && p.checks !== null && n.checks !== null) {
      events.push({
        kind: 'checks_changed',
        taskId,
        number: n.number,
        from: p.checks,
        to: n.checks
      })
    }
  }
  return events
}

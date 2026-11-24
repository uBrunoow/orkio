/** Threads de review de uma PR (Task 15): só em memória, lidas do GitHub pelo main. */
export interface ReviewComment {
  author: string | null
  body: string
  at: string | null
  /** Link do comentário no GitHub (`…/pull/N#discussion_r…`). */
  url: string | null
}

export interface ReviewThread {
  id: string
  resolved: boolean
  outdated: boolean
  path: string | null
  line: number | null
  comments: ReviewComment[]
}

export interface ReviewSummary {
  state: string
  author: string | null
  body: string
  at: string | null
}

export interface ReviewThreadsResult {
  pr: { number: number; url: string }
  threads: ReviewThread[]
  reviews: ReviewSummary[]
  /** Algum texto foi cortado (limite por comentário ou total). */
  truncated: boolean
  /** Threads que existem mas não foram lidas (limite de páginas); contam como pendentes. */
  unreadThreads: number
}

/** Quantas threads precisam de tratamento: nunca 0 por threads não lidas. */
export function pendingCount(result: {
  threads: readonly ReviewThread[]
  unreadThreads: number
}): number {
  return result.threads.filter((t) => !t.resolved).length + result.unreadThreads
}

/** Frase do topo da aba Revisão. */
export function reviewHeadline(
  result: { threads: readonly ReviewThread[]; unreadThreads: number },
  prNumber: number
): string {
  const n = pendingCount(result)
  if (n === 0) return `Nenhum comentário pendente na PR #${prNumber}.`
  return `${n} ${n === 1 ? 'comentário pendente' : 'comentários pendentes'} na PR #${prNumber}.`
}

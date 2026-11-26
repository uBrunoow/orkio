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

/**
 * O que o corretor da PR tem a tratar: conversas pendentes + quem pede alterações agora (revisão
 * com "pedir alterações" só no texto, sem comentário em linha, também conta).
 */
export function actionableCount(result: {
  threads: readonly ReviewThread[]
  unreadThreads: number
  reviews?: readonly ReviewSummary[]
}): number {
  return pendingCount(result) + changesRequestedBy(result.reviews ?? []).length
}

/** Frase do topo da aba Revisão: conversas pendentes e quem pediu alterações (última revisão). */
export function reviewHeadline(
  result: {
    threads: readonly ReviewThread[]
    unreadThreads: number
    reviews?: readonly ReviewSummary[]
  },
  prNumber: number
): string {
  const n = pendingCount(result)
  const who = changesRequestedBy(result.reviews ?? [])
  const asked = who.length ? `alterações pedidas por ${who.map((w) => `@${w}`).join(', ')}` : ''
  const pending = `${n} ${n === 1 ? 'comentário pendente' : 'comentários pendentes'}`
  if (n === 0 && !asked) return `Nenhum comentário pendente na PR #${prNumber}.`
  if (n === 0) return `${asked[0]!.toUpperCase()}${asked.slice(1)} na PR #${prNumber}.`
  return `${pending}${asked ? ` e ${asked}` : ''} na PR #${prNumber}.`
}

/** Quem pede alterações agora: a última revisão de cada pessoa é CHANGES_REQUESTED. */
export function changesRequestedBy(reviews: readonly ReviewSummary[]): string[] {
  const last = new Map<string, ReviewSummary>()
  for (const r of reviews) {
    if (!r.author || r.state === 'PENDING') continue
    const prev = last.get(r.author)
    if (!prev || (r.at ?? '') >= (prev.at ?? '')) last.set(r.author, r)
  }
  return [...last.values()].filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.author!)
}

/** Revisões de topo com texto (pedir alterações ou comentar), mais recentes primeiro. */
export function reviewsWithText(reviews: readonly ReviewSummary[]): ReviewSummary[] {
  return reviews
    .filter((r) => (r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED') && r.body.trim())
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}

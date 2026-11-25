/**
 * Branches remotas e PRs de um repositório do GitHub, para os sinais das tarefas (Etapa 2D).
 *
 * - REST com ETag/If-None-Match por página: 304 reaproveita o cache e não gasta o rate limit
 *   primário. Cache em memória, por repositório (nada vai para o disco).
 * - Detalhes (reviewDecision, threads não resolvidas, checks) só existem no GraphQL: uma query
 *   em lote, só para PRs ligadas a tarefas e só quando mudaram (ou a cada 5 min se abertas).
 */
import type {
  ChecksState,
  PullRequestDetails,
  PullRequestSummary,
  ReviewDecision
} from '../../shared/task-signals'
import {
  parseBranchItem,
  parsePullItem,
  type ConditionalPage
} from '../connectors/github/github.client'
import { isRecord } from '../net/parse'
import { isAuthorLogin } from '../../shared/github-names'
import { REVIEW_LIMITS } from './review-threads'
import { isApiError } from '../net/http'

export interface GitHubSignalsApi {
  getConditional(path: string, etag: string | null): Promise<ConditionalPage>
  graphql(
    query: string,
    variables: Record<string, unknown>
  ): Promise<{ data: unknown; errors: { type: string | null; path: string[] }[] }>
}

export const SIGNALS_LIMITS = {
  branchPages: 10,
  openPullPages: 5,
  closedPullPages: 2,
  closedWindowMs: 30 * 24 * 60 * 60 * 1000,
  detailsBatch: 20,
  /** PR aberta: detalhes revistos ao menos a cada 5 min (resolver thread pode não mudar updated_at). */
  openDetailsTtlMs: 5 * 60 * 1000
} as const

interface CachedPage {
  etag: string | null
  body: unknown
  nextPath: string | null
}

interface CachedDetails {
  updatedAt: string
  fetchedAt: number
  details: PullRequestDetails
}

export interface RepoSnapshot {
  branches: string[]
  branchesTruncated: boolean
  pulls: PullRequestSummary[]
}

export class GitHubRepoSignals {
  private readonly pages = new Map<string, CachedPage>()
  private readonly details = new Map<number, CachedDetails>()
  /** Último aviso do GraphQL (ex.: sem permissão); `null` = ok. */
  detailsWarning: string | null = null

  constructor(
    private readonly api: GitHubSignalsApi,
    readonly owner: string,
    readonly name: string,
    private readonly now: () => number = Date.now
  ) {}

  private get base(): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}`
  }

  /** Lê branches e PRs (abertas + fechadas nos últimos 30 dias). */
  async snapshot(): Promise<RepoSnapshot> {
    const branchPages = await this.walk(
      `${this.base}/branches?per_page=100`,
      SIGNALS_LIMITS.branchPages
    )
    const branches = branchPages.items.map(parseBranchItem).filter((b): b is string => b !== null)

    const open = await this.walk(
      `${this.base}/pulls?state=open&per_page=100`,
      SIGNALS_LIMITS.openPullPages
    )
    const cutoff = this.now() - SIGNALS_LIMITS.closedWindowMs
    const closed = await this.walk(
      `${this.base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      SIGNALS_LIMITS.closedPullPages,
      (items) => {
        const last = parsePullItem(items[items.length - 1])
        return last !== null && Date.parse(last.updatedAt) < cutoff
      }
    )
    const seen = new Set<number>()
    const pulls: PullRequestSummary[] = []
    for (const raw of [...open.items, ...closed.items]) {
      const item = parsePullItem(raw)
      if (!item || seen.has(item.number)) continue
      if (item.state !== 'open' && item.state !== 'draft' && Date.parse(item.updatedAt) < cutoff) {
        continue
      }
      seen.add(item.number)
      pulls.push(item)
    }
    return { branches, branchesTruncated: branchPages.truncated, pulls }
  }

  private async walk(
    firstPath: string,
    maxPages: number,
    stop?: (items: unknown[]) => boolean
  ): Promise<{ items: unknown[]; truncated: boolean }> {
    const items: unknown[] = []
    let path: string | null = firstPath
    let pages = 0
    while (path && pages < maxPages) {
      const cached = this.pages.get(path)
      const result = await this.api.getConditional(path, cached?.etag ?? null)
      let page: CachedPage
      if (result.notModified && cached) {
        page = cached
      } else if (result.notModified) {
        // 304 sem cache (não deveria acontecer): pede de novo sem ETag.
        const fresh = await this.api.getConditional(path, null)
        if (fresh.notModified) break
        page = { etag: fresh.etag, body: fresh.body, nextPath: fresh.nextPath }
        this.pages.set(path, page)
      } else {
        page = { etag: result.etag, body: result.body, nextPath: result.nextPath }
        this.pages.set(path, page)
      }
      const pageItems = Array.isArray(page.body) ? page.body : []
      items.push(...pageItems)
      pages++
      if (stop?.(pageItems)) return { items, truncated: false }
      path = page.nextPath
    }
    return { items, truncated: path !== null }
  }

  /**
   * Detalhes das PRs dadas (as ligadas a tarefas). Usa o cache quando a PR não mudou.
   * Falha do GraphQL não quebra: devolve o que houver em cache e registra `detailsWarning`.
   */
  async pullDetails(
    pulls: readonly PullRequestSummary[]
  ): Promise<Map<number, PullRequestDetails>> {
    const now = this.now()
    const stale = pulls.filter((p) => {
      const cached = this.details.get(p.number)
      if (!cached || cached.updatedAt !== p.updatedAt) return true
      const open = p.state === 'open' || p.state === 'draft'
      return open && now - cached.fetchedAt > SIGNALS_LIMITS.openDetailsTtlMs
    })

    for (let i = 0; i < stale.length; i += SIGNALS_LIMITS.detailsBatch) {
      const batch = stale.slice(i, i + SIGNALS_LIMITS.detailsBatch)
      try {
        const { data, errors } = await this.api.graphql(detailsQuery(batch.map((p) => p.number)), {
          owner: this.owner,
          name: this.name
        })
        const parsed = parseDetails(
          data,
          batch.map((p) => p.number)
        )
        for (const pull of batch) {
          const details = parsed.get(pull.number)
          if (details) {
            this.details.set(pull.number, { updatedAt: pull.updatedAt, fetchedAt: now, details })
          }
        }
        this.detailsWarning = errors.some(
          (e) => e.type === 'FORBIDDEN' || e.type === 'INSUFFICIENT_SCOPES'
        )
          ? 'Parte dos detalhes das PRs (revisão ou checks) não está disponível com esta conta.'
          : null
      } catch (error) {
        this.detailsWarning =
          isApiError(error, 'github') && error.code === 'forbidden'
            ? error.message
            : 'Não foi possível carregar revisões e comentários das PRs agora. Mostrando o que já se sabe.'
        break
      }
    }

    const result = new Map<number, PullRequestDetails>()
    for (const pull of pulls) {
      const cached = this.details.get(pull.number)
      if (cached) result.set(pull.number, cached.details)
    }
    return result
  }
}

/** Query em lote com aliases (números são inteiros: sem injeção). */
export function detailsQuery(numbers: readonly number[]): string {
  const fields = numbers
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .map(
      (n) =>
        `pr${n}: pullRequest(number: ${n}) { number additions deletions changedFiles reviewDecision mergeable ` +
        `reviewThreads(first: ${REVIEW_LIMITS.threads}) { nodes { id isResolved } } ` +
        `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } ` +
        // 3B: ids estáveis para eventos idempotentes (pedidos de review e reviews com decisão).
        `timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) { nodes { ... on ReviewRequestedEvent { id createdAt requestedReviewer { ... on User { login } } } } } ` +
        // 5C: logins só em memória, para pedir review de novo a quem já revisou/foi pedido.
        `reviews(last: 20, states: [APPROVED, CHANGES_REQUESTED]) { nodes { id state submittedAt author { login } } } }`
    )
    .join(' ')
  return `query PullRequestDetails($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`
}

const REVIEW: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'review_required'
}

const CHECKS: Record<string, ChecksState> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending'
}

/**
 * Revisor pedido: só login de usuário (a query pede `... on User`; time exigiria `read:org` e chega
 * sem nome).
 */
function reviewerOf(value: unknown): string | null {
  return isRecord(value) && isAuthorLogin(value['login']) ? value['login'] : null
}

export function parseDetails(
  data: unknown,
  numbers: readonly number[]
): Map<number, PullRequestDetails> {
  const result = new Map<number, PullRequestDetails>()
  const repo = isRecord(data) && isRecord(data['repository']) ? data['repository'] : null
  if (!repo) return result
  for (const n of numbers) {
    const pr = repo[`pr${n}`]
    if (!isRecord(pr)) continue
    const review =
      typeof pr['reviewDecision'] === 'string' ? REVIEW[pr['reviewDecision']] : undefined
    const threads = isRecord(pr['reviewThreads']) ? pr['reviewThreads']['nodes'] : null
    const unresolved = Array.isArray(threads)
      ? threads.filter((t) => isRecord(t) && t['isResolved'] === false).length
      : null
    const commits = isRecord(pr['commits']) ? pr['commits']['nodes'] : null
    const commit = Array.isArray(commits) && isRecord(commits[0]) ? commits[0]['commit'] : null
    const rollup =
      isRecord(commit) && isRecord(commit['statusCheckRollup']) ? commit['statusCheckRollup'] : null
    const checks =
      rollup && typeof rollup['state'] === 'string' ? CHECKS[rollup['state']] : undefined
    const timeline = isRecord(pr['timelineItems']) ? pr['timelineItems']['nodes'] : null
    const reviewNodes = isRecord(pr['reviews']) ? pr['reviews']['nodes'] : null
    const size = (key: string): { [k: string]: number } => {
      const v = pr[key]
      return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? { [key]: v } : {}
    }
    // UNKNOWN (o GitHub ainda calcula) fica de fora: só o que ele já sabe.
    const mergeable =
      pr['mergeable'] === 'CONFLICTING'
        ? { conflict: true }
        : pr['mergeable'] === 'MERGEABLE'
          ? { conflict: false }
          : {}
    result.set(n, {
      ...mergeable,
      ...size('additions'),
      ...size('deletions'),
      ...size('changedFiles'),
      reviewDecision: review ?? null,
      unresolvedComments: unresolved,
      checks: checks ?? null,
      reviewRequests: Array.isArray(timeline)
        ? timeline.flatMap((t) =>
            isRecord(t) && typeof t['id'] === 'string' && typeof t['createdAt'] === 'string'
              ? [{ id: t['id'], at: t['createdAt'], reviewer: reviewerOf(t['requestedReviewer']) }]
              : []
          )
        : [],
      reviews: Array.isArray(reviewNodes)
        ? reviewNodes.flatMap((r) => {
            if (!isRecord(r) || typeof r['id'] !== 'string') return []
            const state =
              r['state'] === 'APPROVED'
                ? 'approved'
                : r['state'] === 'CHANGES_REQUESTED'
                  ? 'changes_requested'
                  : null
            const at = typeof r['submittedAt'] === 'string' ? r['submittedAt'] : null
            const author = isRecord(r['author']) ? r['author']['login'] : null
            return state && at
              ? [
                  {
                    id: r['id'],
                    state,
                    at,
                    author: isAuthorLogin(author) ? author : null
                  } as const
                ]
              : []
          })
        : [],
      unresolvedThreadIds: Array.isArray(threads)
        ? threads.flatMap((t) =>
            isRecord(t) && t['isResolved'] === false && typeof t['id'] === 'string' ? [t['id']] : []
          )
        : []
    })
  }
  return result
}

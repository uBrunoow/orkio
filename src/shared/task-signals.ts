/**
 * Sinais de uma tarefa (branch local/remota, PR) calculados a partir do git local e do GitHub.
 * Base das automações da Etapa 3: aqui só calculamos (`buildTaskSignals`) e comparamos
 * (`diffSignals`). Funções puras, sem Node/DOM.
 */
import type { ProjectAction } from './projects'
import { normalizePageId } from './slug'
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
  /** Commit no topo da branch da PR (REST `head.sha`); para conferir o push (5C). */
  headSha?: string | null
  updatedAt: string
  /** Quando foi aberta (REST `created_at`); Visão geral (6D): PR sem review há N dias. */
  createdAt?: string | null
  /** Quando foi fechada/mergeada (REST `closed_at`); `null` se aberta. */
  closedAt?: string | null
  /** Login de quem abriu (REST); só para o cartão da PR, nunca vai ao snapshot da 3B. */
  author?: string | null
  /** Páginas do Notion citadas no corpo da PR (ids normalizados): ligam a PR à tarefa sem ID. */
  notionPageIds?: string[]
}

/** Detalhes que vêm do GraphQL (podem faltar: sem permissão, falha, ainda não carregados). */
export interface PullRequestDetails {
  reviewDecision: ReviewDecision | null
  /** Threads de review não resolvidas; `null` = indisponível. */
  unresolvedComments: number | null
  checks: ChecksState | null
  /** Pedidos de review (ids do GitHub, inclusive re-pedidos). Só para automações (3B). */
  reviewRequests?: { id: string; at: string; reviewer?: string | null }[]
  /** Reviews com decisão (APPROVED / CHANGES_REQUESTED). */
  reviews?: {
    id: string
    state: 'approved' | 'changes_requested'
    at: string
    /** Login de quem revisou (5C: pedir review de novo). Fica só em memória. */
    author?: string | null
  }[]
  /** Ids das threads de review não resolvidas. */
  unresolvedThreadIds?: string[]
  /** Conflito com a base (GraphQL `mergeable: CONFLICTING`); ausente = desconhecido. */
  conflict?: boolean
  /** Tamanho da PR (GraphQL); só para o cartão. Ausente = desconhecido. */
  additions?: number
  deletions?: number
  changedFiles?: number
}

export interface TaskPullRequest extends PullRequestSummary, PullRequestDetails {}

export interface TaskSignals {
  taskId: string
  /** ID do Notion (ORK-142); `null` em bancos sem a propriedade de ID. */
  displayId: string | null
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

/** Tarefa para os sinais: id da página, ID do Notion (opcional) e branches ligadas a ela. */
export interface SignalTask {
  id: string
  displayId: string | null
  /**
   * Branches registradas para a tarefa (criadas pelo Orkio ou vinculadas à mão, `task_branches`):
   * casam pelo nome exato, mesmo sem o ID no nome (`feat/listar-pedidos`).
   */
  branches?: readonly string[]
}

/**
 * Sinais de cada tarefa. Três caminhos, somados:
 * 1. o ID com prefixo no nome da branch ou no título/branch da PR (ORK-142). Tarefas sem prefixo
 *    no ID (só número) não casam por aqui: um número solto em nomes de branch seria arriscado;
 * 2. as branches registradas para a tarefa (nome exato) e as PRs dessas branches;
 * 3. as PRs com o link da página da tarefa no corpo (o `/alva-flow:pr` põe o link do Notion).
 */
export function buildTaskSignals(
  tasks: readonly SignalTask[],
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
  const pullsByPage = new Map<string, PullRequestSummary[]>()
  for (const p of sources.pulls ?? []) {
    for (const id of p.notionPageIds ?? []) {
      const list = pullsByPage.get(id) ?? []
      list.push(p)
      pullsByPage.set(id, list)
    }
  }
  const localSet = new Set(sources.localBranches)
  const remoteSet = new Set(sources.remoteBranches ?? [])

  for (const task of tasks) {
    const parsed = parseDisplayId(task.displayId)
    let byId: { local: string[]; remote: string[]; pulls: PullRequestSummary[] } = {
      local: [],
      remote: [],
      pulls: []
    }
    if (parsed) {
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
      byId = {
        local: index.local.get(parsed.number) ?? [],
        remote: index.remote.get(parsed.number) ?? [],
        pulls: index.pulls.get(parsed.number) ?? []
      }
    }
    const linked = new Set(task.branches ?? [])
    const local = new Set([...byId.local, ...[...linked].filter((b) => localSet.has(b))])
    const remote = new Set([...byId.remote, ...[...linked].filter((b) => remoteSet.has(b))])
    const pullSet = new Set<PullRequestSummary>([
      ...byId.pulls,
      ...(sources.pulls ?? []).filter((p) => linked.has(p.headRef)),
      ...(pullsByPage.get(normalizePageId(task.id)) ?? [])
    ])
    // Sem nenhum caminho que ligue algo à tarefa: sem sinais.
    if (!parsed && linked.size === 0 && pullSet.size === 0) continue
    const pulls = [...pullSet].sort(comparePulls)
    const main = pulls[0]
    const details = main ? sources.details.get(main.number) : undefined
    result[task.id] = {
      taskId: task.id,
      displayId: task.displayId,
      localBranches: [...local].sort(),
      remoteBranches: [...remote].sort(),
      pr: main
        ? {
            ...main,
            reviewDecision: details?.reviewDecision ?? null,
            unresolvedComments: details?.unresolvedComments ?? null,
            checks: details?.checks ?? null,
            ...(details?.additions !== undefined ? { additions: details.additions } : {}),
            ...(details?.deletions !== undefined ? { deletions: details.deletions } : {}),
            ...(details?.changedFiles !== undefined ? { changedFiles: details.changedFiles } : {}),
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

/** Situação da parte do GitHub nos sinais. */
export type SignalsGitHubState =
  | 'ok'
  | 'disconnected'
  | 'no_repo'
  | 'enterprise'
  | 'no_access'
  | 'sso'
  | 'restricted'
  | 'rate_limited'
  | 'unverified'

export interface TaskSignalsResult {
  /** Por id da página da tarefa no Notion. */
  signals: Record<string, TaskSignals>
  github: SignalsGitHubState
  /** Branches locais lidas? (pasta/git indisponível → false) */
  local: boolean
  /** Avisos curtos em pt-BR (sem GitHub, sem acesso, detalhes indisponíveis...). */
  messages: string[]
  /** Link sugerido (autorizar SSO, pedir aprovação da organização). */
  action?: ProjectAction
  /** Tarefas cujo ID não tem prefixo (não dá para casar com branches/PRs). */
  tasksWithoutPrefix: number
  fetchedAt: string
}

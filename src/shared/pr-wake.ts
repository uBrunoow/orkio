/**
 * Fase 5: "a PR acorda o fluxo" (puro). O passo "Esperar a PR" guarda uma foto da PR (`PrWatch`)
 * quando começa a esperar; a cada leitura dos sinais (os mesmos do quadro e das automações, sem
 * rede extra) o Orkio compara a foto com a PR de agora e decide se algo novo aconteceu:
 *
 * - `merge`: a PR foi mergeada (acorda na hora: não há mais nada a juntar);
 * - `fechada`: fechada sem merge;
 * - `comentarios`: review pedindo mudanças, review/thread de comentário nova;
 * - `ci_falhou`: o CI do commit de agora falhou (e não era a falha que já estava na foto).
 *
 * Debounce: comentários e CI chegam em rajadas (várias threads de uma review, vários checks). O
 * fluxo só acorda quando a PR fica parada por `PR_WAKE_DEBOUNCE_MS` desde a última mudança vista.
 */
import type { PrWakeEvent } from './orkio-actions'
import type { TaskPullRequest } from './task-signals'

export const PR_WAKE_DEBOUNCE_MS = 2 * 60_000

/** Quantas vezes o fluxo volta a esperar a PR (correções) antes de encerrar como esgotado. */
export const PR_WAKE_MAX_CYCLES = 20

/** Foto da PR: só ids, estados e contagens (nada de texto). */
export interface PrWatch {
  number: number
  state: TaskPullRequest['state']
  headSha: string | null
  checks: TaskPullRequest['checks']
  reviewDecision: TaskPullRequest['reviewDecision']
  /** Reviews com decisão "pedir mudanças" (ids). */
  changeRequests: string[]
  /** Threads de review não resolvidas (ids). */
  threadIds: string[]
  unresolved: number | null
}

export function prWatchOf(pr: TaskPullRequest | null | undefined): PrWatch | null {
  if (!pr) return null
  return {
    number: pr.number,
    state: pr.merged ? 'merged' : pr.state,
    headSha: pr.headSha ?? null,
    checks: pr.checks ?? null,
    reviewDecision: pr.reviewDecision ?? null,
    changeRequests: (pr.reviews ?? [])
      .filter((r) => r.state === 'changes_requested')
      .map((r) => r.id),
    threadIds: [...(pr.unresolvedThreadIds ?? [])],
    unresolved: pr.unresolvedComments ?? null
  }
}

/** Valida uma foto lida do banco (`state_json`); inválida = `null` (espera como sem foto). */
export function parsePrWatch(value: unknown): PrWatch | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const strings = (x: unknown): string[] | null =>
    Array.isArray(x) && x.every((i) => typeof i === 'string') ? (x as string[]) : null
  const states = ['draft', 'open', 'merged', 'closed']
  if (typeof v['number'] !== 'number' || !states.includes(v['state'] as string)) return null
  const changeRequests = strings(v['changeRequests'])
  const threadIds = strings(v['threadIds'])
  if (!changeRequests || !threadIds) return null
  return {
    number: v['number'],
    state: v['state'] as PrWatch['state'],
    headSha: typeof v['headSha'] === 'string' ? v['headSha'] : null,
    checks: ['success', 'failure', 'pending'].includes(v['checks'] as string)
      ? (v['checks'] as PrWatch['checks'])
      : null,
    reviewDecision: ['approved', 'changes_requested', 'review_required'].includes(
      v['reviewDecision'] as string
    )
      ? (v['reviewDecision'] as PrWatch['reviewDecision'])
      : null,
    changeRequests,
    threadIds,
    unresolved: typeof v['unresolved'] === 'number' ? v['unresolved'] : null
  }
}

/**
 * O que mudou desde a foto (`null` = nada que acorde o fluxo). Sem foto (a PR ainda não tinha
 * aparecido nos sinais), só merge/fechada e uma falha de CI acordam: comentários antigos não.
 * Ordem: merge, fechada, comentários (pedidos de gente; o push da correção reroda o CI), CI.
 */
export function prWakeEvent(baseline: PrWatch | null, now: PrWatch | null): PrWakeEvent | null {
  if (!now) return null
  // Outra PR (a antiga foi fechada e abriram outra): compara com nada.
  const base = baseline && baseline.number === now.number ? baseline : null
  if (now.state === 'merged') return 'merge'
  if (now.state === 'closed') return 'fechada'
  if (base) {
    const newRequest = now.changeRequests.some((id) => !base.changeRequests.includes(id))
    const newThread = now.threadIds.some((id) => !base.threadIds.includes(id))
    const newDecision =
      now.reviewDecision === 'changes_requested' && base.reviewDecision !== 'changes_requested'
    const moreUnresolved =
      now.unresolved !== null && base.unresolved !== null && now.unresolved > base.unresolved
    if (newRequest || newThread || newDecision || moreUnresolved) return 'comentarios'
  }
  if (now.checks === 'failure') {
    const sameFailure = base?.checks === 'failure' && base.headSha === now.headSha
    if (!sameFailure) return 'ci_falhou'
  }
  return null
}

/** Impressão digital da PR para o debounce (qualquer mudança reinicia a contagem). */
export function prFingerprint(w: PrWatch | null): string {
  if (!w) return ''
  return JSON.stringify([
    w.number,
    w.state,
    w.headSha,
    w.checks,
    w.reviewDecision,
    [...w.changeRequests].sort(),
    [...w.threadIds].sort(),
    w.unresolved
  ])
}

/** Debounce de uma espera: a última impressão digital vista e desde quando está igual. */
export interface PrWakeSeen {
  fingerprint: string
  since: number
}

export type PrWakeDecision =
  { kind: 'sleep'; seen: PrWakeSeen | null } | { kind: 'wake'; event: PrWakeEvent }

/**
 * Acorda agora? Merge acorda na hora; o resto espera a PR ficar `debounceMs` sem mudar (CI
 * rodando com `pending` também segura: o resultado final ainda vai chegar).
 */
export function prWakeDecision(input: {
  baseline: PrWatch | null
  now: PrWatch | null
  seen: PrWakeSeen | null
  at: number
  debounceMs?: number
}): PrWakeDecision {
  const { baseline, now, seen, at } = input
  const debounce = input.debounceMs ?? PR_WAKE_DEBOUNCE_MS
  const event = prWakeEvent(baseline, now)
  if (!event) return { kind: 'sleep', seen: null }
  if (event === 'merge') return { kind: 'wake', event }
  const fingerprint = prFingerprint(now)
  if (!seen || seen.fingerprint !== fingerprint) {
    return { kind: 'sleep', seen: { fingerprint, since: at } }
  }
  if (now?.checks === 'pending' && event !== 'ci_falhou') {
    // Comentários com o CI ainda rodando: espera o CI terminar (um despertar só para os dois).
    return { kind: 'sleep', seen }
  }
  return at - seen.since >= debounce ? { kind: 'wake', event } : { kind: 'sleep', seen }
}

/** Texto curto do que acordou o fluxo (fica no passo e no histórico). */
export const PR_WAKE_TEXT: Record<PrWakeEvent, string> = {
  ci_falhou: 'O CI da PR falhou: o fluxo vai corrigir.',
  comentarios: 'Chegou revisão ou comentário novo na PR: o fluxo vai corrigir.',
  merge: 'A PR foi mergeada: a tarefa vai para Concluída.',
  fechada: 'A PR foi fechada sem merge: o fluxo terminou.'
}

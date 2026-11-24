import type { StatusTone } from '../../components/StatusToken'
import { CI_STATUS, isPrOpen, PR_STATE, REVIEW_DECISION } from '../../lib/status-text'
import type { BoardCard } from '../../../../shared/board'
import type { TaskSignals } from '../../../../shared/task-signals'
import type { TaskActivity } from '../overview/task-activity'

export interface CardStatus {
  /** Gancho de teste: o fluxo e a sincronização mantêm os ids que o E2E já usa. */
  kind: 'flow' | 'sync' | 'pr'
  label: string
  tone: StatusTone
}

/**
 * O único estado que o card mostra no canto (6E, referências): o que mais pede a pessoa vence.
 * "Esperando você" e "Fluxo rodando" vêm da Visão geral (`activityByTask`), a mesma regra da lista
 * lateral e do sino.
 * Mesmo mapa do app (StatusToken): esperando você em amarelo, falha em vermelho, fluxo rodando
 * em laranja (o único laranja de estado), o resto neutro.
 */
export function cardStatus(
  card: Pick<BoardCard, 'sync'>,
  activity: TaskActivity,
  signals: Pick<TaskSignals, 'pr'> | undefined
): CardStatus | null {
  const pr = signals?.pr ?? null
  const prOpen = pr !== null && isPrOpen(pr)
  if (activity.waiting) return { kind: 'flow', label: 'Esperando você', tone: 'warning' }
  if (card.sync.state === 'failed')
    return { kind: 'sync', label: 'Não sincronizou', tone: 'danger' }
  if (prOpen && pr.checks === 'failure') return { kind: 'pr', ...CI_STATUS.failure }
  if (prOpen && pr.reviewDecision === 'changes_requested')
    return { kind: 'pr', ...REVIEW_DECISION.changes_requested }
  if (activity.running?.kind === 'flow')
    return { kind: 'flow', label: 'Fluxo rodando', tone: 'running' }
  if (card.sync.state === 'pending')
    return { kind: 'sync', label: 'Sincronizando', tone: 'neutral' }
  if (pr?.state === 'open') return { kind: 'pr', label: 'Em revisão', tone: 'neutral' }
  if (pr?.state === 'draft') return { kind: 'pr', label: 'PR rascunho', tone: 'neutral' }
  if (pr?.state === 'merged') return { kind: 'pr', ...PR_STATE.merged }
  return null
}

/**
 * Terceira linha do card (quadro no estilo das referências): o que falta de você, senão o que está
 * rodando, senão a PR (número e comentários ou CI).
 */
export function cardDetail(input: {
  waiting: string | null
  running: string | null
  pr: Pick<NonNullable<TaskSignals['pr']>, 'number' | 'unresolvedComments' | 'checks'> | null
}): string | null {
  if (input.waiting) return input.waiting
  if (input.running) return input.running
  const pr = input.pr
  if (!pr) return null
  if (pr.unresolvedComments && pr.unresolvedComments > 0) {
    return `#${pr.number} · ${pr.unresolvedComments} ${pr.unresolvedComments === 1 ? 'comentário' : 'comentários'}`
  }
  if (pr.checks === 'success' || pr.checks === 'failure') {
    return `#${pr.number} · ${CI_STATUS[pr.checks].label}`
  }
  return `#${pr.number}`
}

import type { BoardCard, TaskSignals } from '../../../../shared/ipc-contract'
import type { StatusTone } from '../../components/StatusToken'

export interface CardStatus {
  /** Gancho de teste: o fluxo e a sincronização mantêm os ids que o E2E já usa. */
  kind: 'flow' | 'sync' | 'pr'
  label: string
  tone: StatusTone
}

/**
 * O único estado que o card mostra no canto (6E, referências): o que mais pede a pessoa vence.
 * Mesmo mapa do app (StatusToken): esperando você em amarelo, falha em vermelho, fluxo rodando
 * em laranja (o único laranja de estado), o resto neutro.
 */
export function cardStatus(
  card: Pick<BoardCard, 'sync'>,
  flow: 'running' | 'needs_you' | null,
  signals: Pick<TaskSignals, 'pr'> | undefined
): CardStatus | null {
  const pr = signals?.pr ?? null
  const prOpen = pr !== null && (pr.state === 'open' || pr.state === 'draft')
  if (flow === 'needs_you') return { kind: 'flow', label: 'Esperando você', tone: 'warning' }
  if (card.sync.state === 'failed')
    return { kind: 'sync', label: 'Não sincronizou', tone: 'danger' }
  if (prOpen && pr.checks === 'failure') return { kind: 'pr', label: 'CI falhou', tone: 'danger' }
  if (prOpen && pr.reviewDecision === 'changes_requested')
    return { kind: 'pr', label: 'Alterações pedidas', tone: 'warning' }
  if (flow === 'running') return { kind: 'flow', label: 'Fluxo rodando', tone: 'running' }
  if (card.sync.state === 'pending')
    return { kind: 'sync', label: 'Sincronizando', tone: 'neutral' }
  if (pr?.state === 'open') return { kind: 'pr', label: 'Em revisão', tone: 'neutral' }
  if (pr?.state === 'draft') return { kind: 'pr', label: 'PR rascunho', tone: 'neutral' }
  if (pr?.state === 'merged') return { kind: 'pr', label: 'Mergeada', tone: 'success' }
  return null
}

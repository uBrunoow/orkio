/** Respostas rápidas acima do campo de mensagem (D12): as ações do próprio cartão. */
import type { WaitingKind } from '../../../../shared/overview'

export interface ReplyChip {
  label: string
  action: 'approve' | 'reject' | 'adjust'
}

export function replyChips(kind: WaitingKind): ReplyChip[] {
  if (kind === 'gate' || kind === 'action') {
    return [
      { label: 'Aprovar', action: 'approve' },
      { label: 'Pedir ajuste…', action: 'adjust' }
    ]
  }
  return []
}

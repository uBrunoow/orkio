/** Pré-checagem dos anexos no campo da sessão (o main confere de novo, pelo conteúdo). */
import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_MESSAGES,
  attachmentType
} from '../../../../shared/attachments'

export interface PendingAttachment {
  key: string
  file: File
}

/** Devolve a mensagem do primeiro problema ao juntar `incoming` aos `current`, ou null. */
export function checkNewAttachments(
  current: readonly { name: string }[],
  incoming: readonly { name: string; size: number }[]
): string | null {
  if (current.length + incoming.length > ATTACHMENT_LIMITS.maxFiles) {
    return ATTACHMENT_MESSAGES.tooMany
  }
  for (const f of incoming) {
    if (!attachmentType(f.name)) return ATTACHMENT_MESSAGES.unknownType(f.name)
    if (f.size > ATTACHMENT_LIMITS.maxBytes) return ATTACHMENT_MESSAGES.tooBig(f.name)
  }
  return null
}

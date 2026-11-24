/** Pré-checagem dos anexos no campo da sessão (o main confere de novo, pelo conteúdo). */
export const ATTACH_MAX_FILES = 5
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024
export const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.md,.markdown,.txt'
const EXTS = new Set(ATTACH_ACCEPT.split(',').map((e) => e.slice(1)))

export interface PendingAttachment {
  key: string
  file: File
}

/** Devolve a mensagem do primeiro problema ao juntar `incoming` aos `current`, ou null. */
export function checkNewAttachments(
  current: readonly { name: string }[],
  incoming: readonly { name: string; size: number }[]
): string | null {
  if (current.length + incoming.length > ATTACH_MAX_FILES) return 'Até 5 anexos por mensagem.'
  for (const f of incoming) {
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''
    if (!EXTS.has(ext)) {
      return `Tipo de arquivo não aceito: ${f.name}. Use imagem (PNG, JPEG, WEBP, GIF), PDF, Markdown ou texto.`
    }
    if (f.size > ATTACH_MAX_BYTES) return `O arquivo ${f.name} é maior que 10 MB.`
  }
  return null
}

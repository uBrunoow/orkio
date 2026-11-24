/**
 * Anexos do campo da sessão: limites, extensões aceitas e mensagens. O renderer pré-checa pelo nome
 * e pelo tamanho; o main (`main/claude/attachments.ts`) confere de novo, pelo conteúdo.
 */

export const ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024 } as const

export type AttachmentExt = 'png' | 'jpg' | 'webp' | 'gif' | 'pdf' | 'md' | 'txt'

/** Extensão no nome do arquivo → tipo gravado (o arquivo salvo leva a extensão do tipo). */
export const ATTACHMENT_EXTENSIONS: Readonly<Record<string, AttachmentExt>> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  pdf: 'pdf',
  md: 'md',
  markdown: 'md',
  txt: 'txt'
}

/** Valor do `accept` do campo de arquivo. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',')

const MAX_MB = ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)

export const ATTACHMENT_MESSAGES = {
  tooMany: `Até ${ATTACHMENT_LIMITS.maxFiles} anexos por mensagem.`,
  tooBig: (name: string): string => `O arquivo ${name} é maior que ${MAX_MB} MB.`,
  unknownType: (name: string): string =>
    `Tipo de arquivo não aceito: ${name}. Use imagem (PNG, JPEG, WEBP, GIF), PDF, Markdown ou texto.`,
  mismatch: (name: string, what: string): string => `O arquivo ${name} não é ${what}.`
}

/** Tipo pela extensão do nome (sem caixa), ou `null` se a extensão não é aceita. */
export function attachmentType(name: string): AttachmentExt | null {
  const i = name.lastIndexOf('.')
  const ext = i < 0 ? '' : name.slice(i + 1).toLowerCase()
  return Object.hasOwn(ATTACHMENT_EXTENSIONS, ext) ? ATTACHMENT_EXTENSIONS[ext]! : null
}

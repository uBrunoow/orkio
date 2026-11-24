/**
 * Anexos do campo da sessão: validam pelo conteúdo (assinatura de bytes), gravam só em
 * `<worktree>/.orkio/attachments/` e viram uma nota no texto (o Claude lê com a ferramenta Read).
 * Nada do conteúdo vai para log, evento ou banco.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const ATTACHMENT_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024 } as const

export type AttachmentExt = 'png' | 'jpg' | 'webp' | 'gif' | 'pdf' | 'md' | 'txt'

export const ATTACHMENT_MESSAGES = {
  tooMany: 'Até 5 anexos por mensagem.',
  tooBig: (name: string): string => `O arquivo ${name} é maior que 10 MB.`,
  unknownType: (name: string): string =>
    `Tipo de arquivo não aceito: ${name}. Use imagem (PNG, JPEG, WEBP, GIF), PDF, Markdown ou texto.`,
  mismatch: (name: string, what: string): string => `O arquivo ${name} não é ${what}.`
}

const BINARY: Record<string, { ext: AttachmentExt; what: string }> = {
  png: { ext: 'png', what: 'uma imagem PNG' },
  jpg: { ext: 'jpg', what: 'uma imagem JPEG' },
  jpeg: { ext: 'jpg', what: 'uma imagem JPEG' },
  webp: { ext: 'webp', what: 'uma imagem WEBP' },
  gif: { ext: 'gif', what: 'uma imagem GIF' },
  pdf: { ext: 'pdf', what: 'um PDF' }
}
const TEXT_EXTS = new Set(['md', 'markdown', 'txt'])

function startsWith(data: Uint8Array, bytes: number[], offset = 0): boolean {
  return bytes.every((b, i) => data[offset + i] === b)
}
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

function matches(ext: AttachmentExt, d: Uint8Array): boolean {
  switch (ext) {
    case 'png':
      return startsWith(d, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'jpg':
      return startsWith(d, [0xff, 0xd8, 0xff])
    case 'gif':
      return startsWith(d, ascii('GIF87a')) || startsWith(d, ascii('GIF89a'))
    case 'webp':
      return startsWith(d, ascii('RIFF')) && startsWith(d, ascii('WEBP'), 8)
    case 'pdf':
      return startsWith(d, ascii('%PDF-'))
    default:
      return false
  }
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function sniffAttachment(
  name: string,
  data: Uint8Array
): { ok: true; ext: AttachmentExt } | { ok: false; message: string } {
  if (data.byteLength > ATTACHMENT_LIMITS.maxBytes) {
    return { ok: false, message: ATTACHMENT_MESSAGES.tooBig(name) }
  }
  const raw = extensionOf(name)
  const bin = BINARY[raw]
  if (bin) {
    return matches(bin.ext, data)
      ? { ok: true, ext: bin.ext }
      : { ok: false, message: ATTACHMENT_MESSAGES.mismatch(name, bin.what) }
  }
  if (TEXT_EXTS.has(raw)) {
    const notText = ATTACHMENT_MESSAGES.mismatch(name, 'um texto válido')
    if (data.includes(0)) return { ok: false, message: notText }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      return { ok: false, message: notText }
    }
    return { ok: true, ext: raw === 'md' || raw === 'markdown' ? 'md' : 'txt' }
  }
  return { ok: false, message: ATTACHMENT_MESSAGES.unknownType(name) }
}

/** Só `[A-Za-z0-9._-]`, sem pontos iniciais, no máximo 80 caracteres, sem pastas. */
export function safeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
  const out = cleaned.slice(-80)
  return out.replace(/^\.+/, '') || 'anexo'
}

/** Valida tudo antes de gravar qualquer coisa; devolve a mensagem do primeiro problema. */
export function checkAttachments(
  files: readonly { name: string; data: Uint8Array }[]
): { ok: true; exts: AttachmentExt[] } | { ok: false; message: string } {
  if (files.length > ATTACHMENT_LIMITS.maxFiles) {
    return { ok: false, message: ATTACHMENT_MESSAGES.tooMany }
  }
  const exts: AttachmentExt[] = []
  for (const f of files) {
    const r = sniffAttachment(f.name, f.data)
    if (!r.ok) return r
    exts.push(r.ext)
  }
  return { ok: true, exts }
}

/** Grava em `<worktree>/.orkio/attachments/<sha8>-<nome>` (0600) e devolve os caminhos relativos. */
export async function saveAttachments(
  worktree: string,
  files: readonly { name: string; data: Uint8Array }[]
): Promise<string[]> {
  const checked = checkAttachments(files)
  if (!checked.ok) throw new Error(checked.message)
  const dir = join(worktree, '.orkio', 'attachments')
  await mkdir(dir, { recursive: true })
  // Fora do git do usuário (no worktree, `.git` é arquivo: a exclusão é a da própria pasta).
  await writeFile(join(worktree, '.orkio', '.gitignore'), '*\n', 'utf8')
  const paths: string[] = []
  for (const [i, f] of files.entries()) {
    const sha = createHash('sha256').update(f.data).digest('hex').slice(0, 8)
    let safe = safeAttachmentName(f.name)
    // Binários: a extensão vem do tipo detectado; texto: .md ou .txt.
    const ext = checked.exts[i]!
    const dot = safe.lastIndexOf('.')
    const stem = dot > 0 ? safe.slice(0, dot) : safe
    safe = `${stem}.${ext}`
    const rel = `.orkio/attachments/${sha}-${safe}`
    await writeFile(join(worktree, rel), f.data, { mode: 0o600 })
    paths.push(rel)
  }
  return paths
}

export function attachmentNote(paths: readonly string[]): string {
  return `\n\nAnexos (leia com a ferramenta Read): ${paths.join(', ')}`
}

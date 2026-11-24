/**
 * Anexos do campo da sessão: validam pelo conteúdo (assinatura de bytes), gravam só em
 * `<worktree>/.orkio/attachments/` e viram uma nota no texto (o Claude lê com a ferramenta Read).
 * Nada do conteúdo vai para log, evento ou banco.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_MESSAGES,
  attachmentType,
  type AttachmentExt
} from '../../shared/attachments'
import { stripAccents } from '../../shared/text'
import { ATTACHMENTS_DIR } from '../../shared/orkio-scratch'
import { ensureScratch } from './scratch'

const BINARY_WHAT: Partial<Record<AttachmentExt, string>> = {
  png: 'uma imagem PNG',
  jpg: 'uma imagem JPEG',
  webp: 'uma imagem WEBP',
  gif: 'uma imagem GIF',
  pdf: 'um PDF'
}

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

export function sniffAttachment(
  name: string,
  data: Uint8Array
): { ok: true; ext: AttachmentExt } | { ok: false; message: string } {
  if (data.byteLength > ATTACHMENT_LIMITS.maxBytes) {
    return { ok: false, message: ATTACHMENT_MESSAGES.tooBig(name) }
  }
  const ext = attachmentType(name)
  if (!ext) return { ok: false, message: ATTACHMENT_MESSAGES.unknownType(name) }
  const what = BINARY_WHAT[ext]
  if (what) {
    return matches(ext, data)
      ? { ok: true, ext }
      : { ok: false, message: ATTACHMENT_MESSAGES.mismatch(name, what) }
  }
  const notText = ATTACHMENT_MESSAGES.mismatch(name, 'um texto válido')
  if (data.includes(0)) return { ok: false, message: notText }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return { ok: false, message: notText }
  }
  return { ok: true, ext }
}

export function safeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = stripAccents(base)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
  const out = cleaned.slice(-80)
  return out.replace(/^\.+/, '') || 'anexo'
}

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
  await ensureScratch(worktree)
  await mkdir(join(worktree, ATTACHMENTS_DIR), { recursive: true })
  const paths: string[] = []
  for (const [i, f] of files.entries()) {
    const sha = createHash('sha256').update(f.data).digest('hex').slice(0, 8)
    let safe = safeAttachmentName(f.name)
    const ext = checked.exts[i]!
    const dot = safe.lastIndexOf('.')
    const stem = dot > 0 ? safe.slice(0, dot) : safe
    safe = `${stem}.${ext}`
    const rel = `${ATTACHMENTS_DIR}/${sha}-${safe}`
    await writeFile(join(worktree, rel), f.data, { mode: 0o600 })
    paths.push(rel)
  }
  return paths
}

export function attachmentNote(paths: readonly string[]): string {
  return `\n\nAnexos (leia com a ferramenta Read): ${paths.join(', ')}`
}

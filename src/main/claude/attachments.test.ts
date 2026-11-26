import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SCRATCH_GITIGNORE } from '../../shared/orkio-scratch'
import {
  attachmentNote,
  checkAttachments,
  safeAttachmentName,
  saveAttachments,
  sniffAttachment,
  sniffImage
} from './attachments'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
let dir = ''
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('anexos', () => {
  it('aceita pela assinatura dos bytes', () => {
    expect(sniffAttachment('a.png', PNG)).toEqual({ ok: true, ext: 'png' })
    expect(sniffAttachment('a.jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      ok: true,
      ext: 'jpg'
    })
    expect(sniffAttachment('a.gif', enc('GIF89a....'))).toEqual({ ok: true, ext: 'gif' })
    expect(sniffAttachment('a.webp', enc('RIFF....WEBPVP8 '))).toEqual({ ok: true, ext: 'webp' })
    expect(sniffAttachment('a.pdf', enc('%PDF-1.7'))).toEqual({ ok: true, ext: 'pdf' })
    expect(sniffAttachment('n.md', enc('# oi ç'))).toEqual({ ok: true, ext: 'md' })
    expect(sniffAttachment('n.txt', enc('a: 1'))).toEqual({ ok: true, ext: 'txt' })
  })

  it('recusa conteúdo que não bate com o nome', () => {
    expect(sniffAttachment('x.png', enc('<html><script>alert(1)</script>'))).toEqual({
      ok: false,
      message: 'O arquivo x.png não é uma imagem PNG.'
    })
    expect(sniffAttachment('x.pdf', PNG)).toEqual({
      ok: false,
      message: 'O arquivo x.pdf não é um PDF.'
    })
    expect(sniffAttachment('x.exe', enc('MZ'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('Tipo de arquivo não aceito: x.exe.')
    })
  })

  it('texto: NUL ou UTF-8 inválido recusa; mais de 10 MB recusa', () => {
    expect(sniffAttachment('a.txt', new Uint8Array([0x61, 0, 0x62])).ok).toBe(false)
    expect(sniffAttachment('a.md', new Uint8Array([0xff, 0xfe, 0xfd])).ok).toBe(false)
    expect(sniffAttachment('a.png', new Uint8Array(11 * 1024 * 1024))).toEqual({
      ok: false,
      message: 'O arquivo a.png é maior que 10 MB.'
    })
  })

  it('mais de 5 anexos recusa', () => {
    const f = { name: 'a.txt', data: enc('x') }
    expect(checkAttachments([f, f, f, f, f, f])).toEqual({
      ok: false,
      message: 'Até 5 anexos por mensagem.'
    })
  })

  it('sanea o nome', () => {
    expect(safeAttachmentName('../../a.md')).toBe('a.md')
    expect(safeAttachmentName('..\\..\\x y.png')).toBe('x_y.png')
    expect(safeAttachmentName('.hidden')).toBe('hidden')
    expect(safeAttachmentName('/')).toBe('anexo')
    expect(safeAttachmentName('a'.repeat(200) + '.md').length).toBeLessThanOrEqual(80)
  })

  it('grava só dentro de .orkio/attachments, 0600, com .gitignore', async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-att-'))
    const paths = await saveAttachments(dir, [
      { name: '../../a.md', data: enc('# nota') },
      { name: 'foto.jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }
    ])
    expect(paths[0]).toMatch(/^\.orkio\/attachments\/[0-9a-f]{8}-a\.md$/)
    expect(paths[1]).toMatch(/^\.orkio\/attachments\/[0-9a-f]{8}-foto\.jpg$/)
    expect(await readFile(join(dir, paths[0]!), 'utf8')).toBe('# nota')
    expect((await stat(join(dir, paths[0]!))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(dir, '.orkio', '.gitignore'), 'utf8')).toBe(SCRATCH_GITIGNORE)
    await expect(saveAttachments(dir, [{ name: 'x.png', data: enc('<html>') }])).rejects.toThrow()
  })

  it('a nota', () => {
    expect(attachmentNote(['.orkio/attachments/a-b.md', '.orkio/attachments/c-d.png'])).toBe(
      '\n\nAnexos (leia com a ferramenta Read): .orkio/attachments/a-b.md, .orkio/attachments/c-d.png'
    )
  })
})

describe('sniffImage', () => {
  it('reconhece PNG, JPEG, GIF e WEBP pelos bytes; texto não é imagem', () => {
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImage(enc('GIF89a...'))).toBe('gif')
    expect(sniffImage(enc('RIFF0000WEBPVP8 '))).toBe('webp')
    expect(sniffImage(enc('<svg>oi</svg>'))).toBeNull()
  })
})

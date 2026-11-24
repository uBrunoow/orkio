import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_LIMITS,
  ATTACHMENT_MESSAGES,
  attachmentType
} from './attachments'

describe('anexos (regras comuns ao renderer e ao main)', () => {
  it('tipo pela extensão, sem caixa; extensão desconhecida ou herdada do objeto → null', () => {
    expect(attachmentType('Print.JPEG')).toBe('jpg')
    expect(attachmentType('notas.markdown')).toBe('md')
    expect(attachmentType('x.exe')).toBeNull()
    expect(attachmentType('semponto')).toBeNull()
    expect(attachmentType('x.constructor')).toBeNull()
  })

  it('accept e mensagens saem dos mesmos limites e extensões', () => {
    // O campo de arquivo oferece exatamente o que a checagem aceita.
    const offered = ATTACHMENT_ACCEPT.split(',')
    for (const ext of offered) expect(attachmentType(`a${ext}`), ext).not.toBeNull()
    expect(offered).toHaveLength(Object.keys(ATTACHMENT_EXTENSIONS).length)
    expect(offered).not.toContain('.exe')
    // As mensagens citam os limites de verdade.
    expect(ATTACHMENT_MESSAGES.tooMany).toContain(String(ATTACHMENT_LIMITS.maxFiles))
    expect(ATTACHMENT_MESSAGES.tooBig('a.png')).toContain(
      `${ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)} MB`
    )
  })
})

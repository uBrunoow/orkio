import { describe, expect, it } from 'vitest'
import { ATTACHMENT_ACCEPT, ATTACHMENT_MESSAGES, attachmentType } from './attachments'

describe('anexos (regras comuns ao renderer e ao main)', () => {
  it('tipo pela extensão, sem caixa; extensão desconhecida ou herdada do objeto → null', () => {
    expect(attachmentType('Print.JPEG')).toBe('jpg')
    expect(attachmentType('notas.markdown')).toBe('md')
    expect(attachmentType('x.exe')).toBeNull()
    expect(attachmentType('semponto')).toBeNull()
    expect(attachmentType('x.constructor')).toBeNull()
  })

  it('accept e mensagens saem dos mesmos limites e extensões', () => {
    expect(ATTACHMENT_ACCEPT).toBe('.png,.jpg,.jpeg,.webp,.gif,.pdf,.md,.markdown,.txt')
    expect(ATTACHMENT_MESSAGES.tooMany).toBe('Até 5 anexos por mensagem.')
    expect(ATTACHMENT_MESSAGES.tooBig('a.png')).toBe('O arquivo a.png é maior que 10 MB.')
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeLabel, stripAccents } from './text'

describe('text', () => {
  it('normalizeLabel: sem acento, minúsculas e espaços juntados', () => {
    expect(normalizeLabel('  Em  Andamento ')).toBe('em andamento')
    expect(normalizeLabel('Revisão\tPendente')).toBe('revisao pendente')
  })

  it('stripAccents mantém a caixa', () => {
    expect(stripAccents('Ação Já')).toBe('Acao Ja')
  })
})

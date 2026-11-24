import { describe, expect, it } from 'vitest'
import { effectiveOpenId, firstPendingId, matchesQuery } from './integrations-logic'

const gh = { name: 'GitHub CLI', category: 'terminal · opcional', section: 'Código' }

describe('matchesQuery', () => {
  it('casa por nome, categoria e seção, sem acento nem caixa', () => {
    expect(matchesQuery(gh, 'git')).toBe(true)
    expect(matchesQuery(gh, 'TERMINAL')).toBe(true)
    expect(matchesQuery(gh, 'codigo')).toBe(true)
    expect(matchesQuery(gh, 'notion')).toBe(false)
    expect(matchesQuery(gh, '  ')).toBe(true)
  })
})

describe('abertura automática', () => {
  it('escolhe o primeiro pendente na ordem da página', () => {
    expect(
      firstPendingId([
        { id: 'a', pending: false },
        { id: 'b', pending: true },
        { id: 'c', pending: true }
      ])
    ).toBe('b')
    expect(firstPendingId([{ id: 'a', pending: false }])).toBeNull()
  })

  it('a escolha da pessoa vence; sem escolha, pendente e depois o último', () => {
    expect(effectiveOpenId('x', 'b', 'a')).toBe('x')
    expect(effectiveOpenId(null, 'b', 'a')).toBeNull()
    expect(effectiveOpenId(undefined, 'b', 'a')).toBe('b')
    expect(effectiveOpenId(undefined, null, 'a')).toBe('a')
    expect(effectiveOpenId(undefined, null, null)).toBeNull()
  })
})

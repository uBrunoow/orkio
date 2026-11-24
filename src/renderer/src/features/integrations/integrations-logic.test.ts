import { describe, expect, it } from 'vitest'
import {
  effectiveOpenId,
  firstPendingId,
  matchesQuery,
  orkioBotSummary
} from './integrations-logic'

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

describe('orkioBotSummary', () => {
  const repo = (state: string) => ({ status: { state } })
  it('estados do cartão do orkio[bot]', () => {
    expect(orkioBotSummary(null).tone).toBe('neutral')
    expect(orkioBotSummary({ github: 'disconnected', repos: [] }).label).toBe(
      'Conecte o GitHub antes'
    )
    expect(orkioBotSummary({ github: 'connected', repos: [] }).label).toBe(
      'Nenhum projeto com GitHub'
    )
    expect(orkioBotSummary({ github: 'connected', repos: [repo('not_installed')] })).toEqual({
      label: 'Não instalado no repositório',
      tone: 'warning'
    })
    expect(
      orkioBotSummary({
        github: 'connected',
        repos: [repo('installed'), repo('not_installed'), repo('unknown')]
      }).label
    ).toBe('Falta instalar em 1 de 3 repositórios')
    expect(
      orkioBotSummary({ github: 'connected', repos: [repo('installed'), repo('installed')] })
    ).toEqual({ label: 'Instalado nos 2 repositórios', tone: 'success' })
    expect(orkioBotSummary({ github: 'connected', repos: [repo('unknown')] }).tone).toBe('neutral')
  })
})

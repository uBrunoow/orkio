import { describe, expect, it } from 'vitest'
import { fixesInIntegrations } from './ErrorAlert'

describe('"Ir para Integrações": uma regra para todas as telas', () => {
  it('o main diz onde resolver (fixAt) ou reconectar o Notion resolve', () => {
    expect(fixesInIntegrations({ fixAt: 'integrations' })).toBe(true)
    expect(fixesInIntegrations({ canReconnect: true })).toBe(true)
  })

  it('código parecido sem fixAt não manda para Integrações (ex.: "crie o quadro" do quadro)', () => {
    // Antes, o Quadro mandava para Integrações todo `not_configured`, inclusive "Crie o quadro".
    expect(fixesInIntegrations({})).toBe(false)
  })
})

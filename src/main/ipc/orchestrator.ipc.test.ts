import { describe, expect, it } from 'vitest'
import { toOrchestratorConfig } from './orchestrator.ipc'

const OK = {
  enabled: true,
  enabledSince: '2020-01-01T00:00:00.000Z',
  queueStageId: 'fila',
  maxActive: 2,
  lanes: [{ stageId: 'dev', agents: ['builtin:implementador', 'repo:ana'], next: null }]
}

describe('toOrchestratorConfig', () => {
  it('aceita a forma certa; enabledSince é sempre do main', () => {
    expect(toOrchestratorConfig(OK)).toEqual({ ...OK, enabledSince: null })
  })

  it('não ajusta o teto em silêncio (o validador explica)', () => {
    expect(toOrchestratorConfig({ ...OK, maxActive: 99 })?.maxActive).toBe(99)
  })

  it('recusa em vez de descartar: etapa ou agente repetido, chave inválida, forma errada', () => {
    const lane = OK.lanes[0]!
    for (const bad of [
      null,
      [],
      { ...OK, enabled: 'sim' },
      { ...OK, queueStageId: '../x' },
      { ...OK, lanes: [lane, lane] },
      { ...OK, lanes: [{ ...lane, agents: ['repo:ana', 'repo:ana'] }] },
      { ...OK, lanes: [{ ...lane, agents: ['nuvem:x'] }] },
      { ...OK, lanes: [{ ...lane, next: 3 }] },
      { ...OK, lanes: Array.from({ length: 11 }, (_, i) => ({ ...lane, stageId: `s${i}` })) }
    ]) {
      expect(toOrchestratorConfig(bad)).toBeNull()
    }
  })
})

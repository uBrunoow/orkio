import { describe, expect, it } from 'vitest'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import type { Flow } from '../../../../shared/task-flow'
import { flowPurpose } from './flow-purpose'

const step = (s: Record<string, unknown>): Flow['steps'][number] =>
  ({ id: String(s['id'] ?? 'x'), name: 'x', ...s }) as unknown as Flow['steps'][number]

describe('flowPurpose', () => {
  it('modelo conhecido: o texto escrito à mão', () => {
    expect(flowPurpose({ id: ALVA_TEMPLATE_IDS.plan, name: 'Alva: planejar', steps: [] })).toMatch(
      /^Escreve a spec/
    )
  })
  it('fluxo seu: resumo pelos passos', () => {
    const flow: Flow = {
      id: 'meu',
      name: 'Revisar e entregar',
      steps: [
        step({ id: 'a', type: 'claude_command', command: 'revisar', args: '', timeoutMin: 30 }),
        step({
          id: 'b',
          type: 'gate',
          message: 'ok?',
          show: 'diff',
          onReject: 'stop',
          timeoutMin: null
        }),
        step({ id: 'c', type: 'orkio_action', action: 'push' })
      ]
    }
    expect(flowPurpose(flow)).toBe('Roda /revisar, pede sua aprovação uma vez e envia a branch.')
  })
  it('sem passos', () => {
    expect(flowPurpose({ id: 'v', name: 'v', steps: [] })).toMatch(/Ainda sem passos/)
  })
})

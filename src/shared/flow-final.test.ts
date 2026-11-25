import { describe, expect, it } from 'vitest'
import {
  FLOW_RESULTS,
  finalText,
  flowEndResult,
  isSuccessResult,
  isUnfinishedResult
} from './flow-final'
import { flowFinishedText } from './task-history'
import { deriveLane } from './task-lanes'

describe('finais honestos do fluxo', () => {
  it('cada alvo de fim vira o seu final; outro texto não é fim', () => {
    expect(flowEndResult('$fim')).toBe('done')
    expect(flowEndResult('$fim:nada')).toBe('nothing')
    expect(flowEndResult('$fim:esgotado')).toBe('exhausted')
    expect(flowEndResult('$fim:travado')).toBe('stuck')
    expect(flowEndResult('$fim:bloqueado')).toBe('blocked')
    expect(flowEndResult('$fim:outro')).toBeNull()
    expect(flowEndResult('toString')).toBeNull()
    expect(flowEndResult(undefined)).toBeNull()
  })

  it('só concluído e nada a fazer passam a tarefa adiante; os que pedem olhar são os sem decisão sua', () => {
    expect(FLOW_RESULTS.filter(isSuccessResult)).toEqual(['done', 'nothing'])
    expect(FLOW_RESULTS.filter(isUnfinishedResult)).toEqual([
      'blocked',
      'exhausted',
      'stuck',
      'failed'
    ])
  })

  it('textos: valor desconhecido = concluído (linha futura); histórico com o final', () => {
    expect(finalText('exhausted').label).toBe('Esgotado')
    expect(finalText('xyz').label).toBe('Concluído')
    expect(flowFinishedText('stuck')).toBe('Fluxo terminou: travado')
    expect(flowFinishedText('nothing')).toBe('Fluxo terminou: nada a fazer')
    expect(flowFinishedText(null)).toBe('Fluxo concluído')
  })

  it('kanban: esgotado/travado/falhou vão para "Precisa de você"; nada a fazer é Concluído', () => {
    const now = '2026-11-25T12:00:00.000Z'
    const base = {
      task: { projectId: 'p1', taskId: 't1' } as never,
      waiting: null,
      running: null,
      pr: null,
      stageRole: 'work' as const,
      now
    }
    const lane = (result: (typeof FLOW_RESULTS)[number]) =>
      deriveLane({ ...base, lastFlow: { result, endedAt: '2026-11-25T11:00:00.000Z' } })
    expect(lane('exhausted')).toMatchObject({ lane: 'needs_you', what: 'Fluxo esgotado' })
    expect(lane('failed')).toMatchObject({ lane: 'needs_you', what: 'Fluxo falhou' })
    expect(lane('nothing')).toMatchObject({ lane: 'done', what: 'Nada a fazer' })
    expect(lane('done')).toMatchObject({ lane: 'done', what: 'Fluxo concluído' })
  })
})

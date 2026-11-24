import { describe, expect, it } from 'vitest'
import type { StageChange } from './board.service'
import { createEnterStage, isStageEntry } from './stage-entry'

describe('createEnterStage', () => {
  it('ordem fixa: orquestrador → regra da coluna (agentes) → fluxo da coluna', () => {
    const calls: string[] = []
    const listener = (name: string) => ({
      onStageChanged: (c: StageChange) => void calls.push(`${name}:${c.to}`)
    })
    const enterStage = createEnterStage({
      flows: listener('flows'),
      agents: listener('agents'),
      orchestrator: listener('orchestrator')
    })
    enterStage({ projectId: 'p', taskId: 't', from: 'a', to: 'b', source: 'manual' })
    expect(calls).toEqual(['orchestrator:b', 'agents:b', 'flows:b'])
  })
})

describe('isStageEntry', () => {
  const change = (source: StageChange['source'], to: string | null = 'b'): StageChange => ({
    projectId: 'p',
    taskId: 't',
    from: 'a',
    to,
    source
  })
  it('só você ou a automação entrando numa etapa; nunca reconciliação, desfazer ou remoção', () => {
    expect(isStageEntry(change('manual'))).toBe(true)
    expect(isStageEntry(change('automation'))).toBe(true)
    for (const source of ['notion', 'rollback', 'stage_removed'] as const) {
      expect(isStageEntry(change(source))).toBe(false)
    }
    expect(isStageEntry(change('manual', null))).toBe(false)
  })
})

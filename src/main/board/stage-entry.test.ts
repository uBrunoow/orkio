import { describe, expect, it } from 'vitest'
import type { StageChange } from './board.service'
import { createEnterStage } from './stage-entry'

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

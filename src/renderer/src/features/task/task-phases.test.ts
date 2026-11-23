import { describe, expect, it } from 'vitest'
import type { BoardStage } from '../../../../shared/board'
import type { PlanState, PlanStep } from '../task-flows/flow-plan'
import { phaseLabel, taskPhases } from './task-phases'

const step = (
  detail: string,
  state: PlanState,
  kind: PlanStep['kind'] = 'claude_command'
): PlanStep => ({
  id: `${detail}-${state}`,
  name: detail,
  detail,
  kind,
  state,
  visits: 0
})

const stage = (id: string, order: number): BoardStage => ({
  id,
  name: `Etapa ${id}`,
  order,
  notionStatus: { id: null, name: id }
})

describe('phaseLabel', () => {
  it('nomes do alva-flow e de outros comandos', () => {
    expect(phaseLabel('/alva-flow:spec')).toBe('Spec')
    expect(phaseLabel('/alva-flow:plan')).toBe('Plano')
    expect(phaseLabel('/alva-flow:implement')).toBe('Implementar')
    expect(phaseLabel('/alva-flow:review')).toBe('Revisão')
    expect(phaseLabel('/alva-flow:fix')).toBe('Revisão')
    expect(phaseLabel('/alva-flow:commit')).toBe('PR')
    expect(phaseLabel('/alva-flow:pr')).toBe('PR')
    expect(phaseLabel('Ação do Orkio: push')).toBe('PR')
    expect(phaseLabel('/meu-plugin:deploy')).toBe('deploy')
    expect(phaseLabel('/revisar')).toBe('revisar')
    expect(phaseLabel('Sua aprovação')).toBeNull()
    expect(phaseLabel('Ação do Orkio: noop')).toBeNull()
  })
})

describe('taskPhases', () => {
  it('funde comandos e gates na fase', () => {
    const plan = [
      step('/alva-flow:spec', 'done'),
      step('Sua aprovação', 'done', 'gate'),
      step('/alva-flow:plan', 'waiting'),
      step('/alva-flow:implement', 'next'),
      step('/alva-flow:review', 'next'),
      step('/alva-flow:fix', 'next'),
      step('/alva-flow:commit', 'next'),
      step('/alva-flow:pr', 'next')
    ]
    expect(taskPhases({ plan, stages: [], stageId: null })).toEqual([
      { id: 'Spec', label: 'Spec', state: 'done' },
      { id: 'Plano', label: 'Plano', state: 'waiting' },
      { id: 'Implementar', label: 'Implementar', state: 'next' },
      { id: 'Revisão', label: 'Revisão', state: 'next' },
      { id: 'PR', label: 'PR', state: 'next' }
    ])
  })

  it('gate esperando entra na fase anterior', () => {
    const plan = [step('/alva-flow:plan', 'done'), step('Sua aprovação', 'waiting', 'gate')]
    expect(taskPhases({ plan, stages: [], stageId: null })[0]?.state).toBe('waiting')
  })

  it('falha vence', () => {
    const plan = [step('/alva-flow:review', 'done'), step('/alva-flow:fix', 'failed')]
    expect(taskPhases({ plan, stages: [], stageId: null })).toEqual([
      { id: 'Revisão', label: 'Revisão', state: 'failed' }
    ])
  })

  it('pulados contam como feitos', () => {
    const plan = [step('/alva-flow:implement', 'skipped'), step('/alva-flow:review', 'current')]
    expect(taskPhases({ plan, stages: [], stageId: null }).map((p) => p.state)).toEqual([
      'done',
      'current'
    ])
  })

  it('fluxo sem comandos cai nas colunas', () => {
    const plan = [step('Sua aprovação', 'waiting', 'gate')]
    const stages = [stage('a', 0), stage('b', 1)]
    expect(taskPhases({ plan, stages, stageId: 'a' }).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('sem fluxo usa as colunas', () => {
    const stages = [stage('c', 2), stage('a', 0), stage('b', 1)]
    expect(taskPhases({ plan: null, stages, stageId: 'b' })).toEqual([
      { id: 'a', label: 'Etapa a', state: 'done' },
      { id: 'b', label: 'Etapa b', state: 'current' },
      { id: 'c', label: 'Etapa c', state: 'next' }
    ])
  })
})

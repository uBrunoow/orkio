import { describe, expect, it } from 'vitest'
import type { BoardStage } from '../../../../shared/board'
import type { FlowRunView, Step } from '../../../../shared/task-flow'
import { flowPlan, type PlanState, type PlanStep } from '../task-flows/flow-plan'
import { defaultPanelTab } from './panel-tab'
import { currentPhase, taskPhases } from './task-phases'

/** Passo do fluxo com a fase que o plano daria a ele (o teste de ligação passa pelo `flowPlan`). */
const step = (
  phase: PlanStep['phase'],
  state: PlanState,
  kind: PlanStep['kind'] = 'claude_command'
): PlanStep => ({
  id: `${JSON.stringify(phase)}-${state}-${Math.random()}`,
  name: 'passo',
  kind,
  command: null,
  action: null,
  readOnly: false,
  phase,
  waitsForCi: false,
  detail: '',
  state,
  visits: 0
})

const stage = (id: string, order: number): BoardStage => ({
  id,
  name: `Etapa ${id}`,
  order,
  notionStatus: { id: null, name: id }
})

const command = (id: string, cmd: string): Step => ({
  id,
  name: id,
  type: 'claude_command',
  command: cmd,
  args: '',
  timeoutMin: 30
})

const flowRun = (steps: Step[], currentStep: string): FlowRunView => ({
  id: 'f1',
  projectId: 'p',
  taskId: 't',
  flowId: 'f',
  flowName: 'Fluxo',
  steps,
  status: 'running',
  currentStep,
  pauseReason: null,
  result: null,
  startedAt: '2026-11-23T10:00:00Z',
  endedAt: null,
  vars: {},
  history: [],
  choice: null,
  confirm: null,
  agent: null,
  revise: null
})

describe('fases pelo plano do fluxo (comandos, ações e gates)', () => {
  it('comandos do alva-flow, ações do Orkio e outros comandos viram fases; gate e noop não', () => {
    const steps: Step[] = [
      command('spec', 'alva-flow:spec'),
      {
        id: 'ok',
        name: 'ok',
        type: 'gate',
        message: 'Pode?',
        show: 'none',
        onReject: 'stop',
        timeoutMin: null
      },
      command('impl', 'alva-flow:implement'),
      command('fix', 'alva-flow:fix'),
      { id: 'noop', name: 'noop', type: 'orkio_action', action: 'noop' },
      { id: 'push', name: 'push', type: 'orkio_action', action: 'push' },
      command('deploy', 'meu-plugin:deploy')
    ]
    const phases = taskPhases({ plan: flowPlan(flowRun(steps, 'impl')), stages: [], stageId: null })
    expect(phases.map((p) => [p.label, p.phase, p.state])).toEqual([
      ['Spec', 'spec', 'done'],
      ['Implementar', 'implement', 'current'],
      ['Revisão', 'review', 'next'],
      ['PR', 'pr', 'next'],
      ['deploy', null, 'next']
    ])
    // A aba do painel sai da fase (enum), não do rótulo em português.
    expect(
      defaultPanelTab({
        currentPhase: currentPhase(phases)?.phase ?? null,
        hasBacklogDoc: true,
        hasDiff: false,
        hasPr: false
      })
    ).toBe('changes')
  })
})

describe('taskPhases', () => {
  it('fase repetida depois do PR entra na primeira ocorrência (sem ids duplicados)', () => {
    const plan = [
      step({ id: 'spec' }, 'done'),
      step({ id: 'plan' }, 'done'),
      step({ id: 'implement' }, 'done'),
      step({ id: 'review' }, 'done'),
      step({ id: 'pr' }, 'done'),
      step({ id: 'review' }, 'current'),
      step({ id: 'review' }, 'next')
    ]
    const phases = taskPhases({ plan, stages: [], stageId: null })
    expect(phases.map((p) => p.label)).toEqual(['Spec', 'Plano', 'Implementar', 'Revisão', 'PR'])
    expect(new Set(phases.map((p) => p.id)).size).toBe(5)
    expect(phases[3]?.state).toBe('current')
  })

  it('gate esperando entra na fase anterior', () => {
    const plan = [step({ id: 'plan' }, 'done'), step(null, 'waiting', 'gate')]
    expect(taskPhases({ plan, stages: [], stageId: null })[0]?.state).toBe('waiting')
  })

  it('falha vence', () => {
    const plan = [step({ id: 'review' }, 'done'), step({ id: 'review' }, 'failed')]
    expect(taskPhases({ plan, stages: [], stageId: null })).toEqual([
      { id: 'review', label: 'Revisão', phase: 'review', state: 'failed' }
    ])
  })

  it('pulados contam como feitos', () => {
    const plan = [step({ id: 'implement' }, 'skipped'), step({ id: 'review' }, 'current')]
    expect(taskPhases({ plan, stages: [], stageId: null }).map((p) => p.state)).toEqual([
      'done',
      'current'
    ])
  })

  it('fluxo sem fase cai nas colunas', () => {
    const plan = [step(null, 'waiting', 'gate')]
    const stages = [stage('a', 0), stage('b', 1)]
    expect(taskPhases({ plan, stages, stageId: 'a' }).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('sem fluxo usa as colunas', () => {
    const stages = [stage('c', 2), stage('a', 0), stage('b', 1)]
    expect(taskPhases({ plan: null, stages, stageId: 'b' })).toEqual([
      { id: 'a', label: 'Etapa a', phase: null, state: 'done' },
      { id: 'b', label: 'Etapa b', phase: null, state: 'current' },
      { id: 'c', label: 'Etapa c', phase: null, state: 'next' }
    ])
  })
})

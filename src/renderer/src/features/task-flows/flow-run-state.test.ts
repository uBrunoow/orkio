import { describe, expect, it } from 'vitest'
import { describeFlowProblem } from '../../../../shared/flow-problem'
import {
  FLOW_PAUSE_REASONS,
  isLive,
  needsYou,
  waitingKind
} from '../../../../shared/flow-run-state'
import { buildRunning, flowWaitingItem, type OverviewTask } from '../../../../shared/overview'
import type {
  FlowPauseReason,
  FlowRunStatus,
  FlowRunView,
  Step
} from '../../../../shared/task-flow'
import { flowPlan } from './flow-plan'

/**
 * "Esperando você" tem uma regra só (`shared/flow-run-state.ts`). Aqui, todos os que mostram o
 * estado de um fluxo concordam para cada combinação de status e motivo de pausa: o card, o sino e
 * a lista lateral (`flowWaitingItem`/`buildRunning`, lidos por `activityByTask`), o cartão de
 * problema (`describeFlowProblem`) e o plano.
 */
const STEPS: Step[] = [
  { id: 'a', name: 'A', type: 'claude_command', command: 'x', args: '', timeoutMin: 5 },
  {
    id: 'g',
    name: 'G',
    type: 'gate',
    message: 'Pode?',
    show: 'none',
    onReject: 'stop',
    timeoutMin: null
  }
]
const TASK: OverviewTask = {
  projectId: 'p',
  projectName: 'P',
  taskId: 't',
  displayId: 'ORK-1',
  title: 'T'
}

function run(status: FlowRunStatus, pauseReason: FlowPauseReason | null): FlowRunView {
  return {
    id: 'f',
    projectId: 'p',
    taskId: 't',
    flowId: 'flow',
    flowName: 'Fluxo',
    steps: STEPS,
    status,
    currentStep: status === 'waiting_gate' ? 'g' : 'a',
    pauseReason,
    result: null,
    startedAt: '2026-11-24T10:00:00Z',
    endedAt: null,
    vars: {},
    history: [],
    choice: null,
    confirm: null,
    agent: null,
    revise: null
  }
}

const CASES: [FlowRunStatus, FlowPauseReason | null][] = [
  ['running', null],
  ['waiting_gate', null],
  ['awaiting_decision', 'left_stage'],
  ...FLOW_PAUSE_REASONS.filter((r) => r !== 'left_stage').map(
    (r): [FlowRunStatus, FlowPauseReason] => ['paused', r]
  )
]

describe('estado do fluxo: todos concordam', () => {
  it.each(CASES)('%s / %s', (status, reason) => {
    const r = run(status, reason)
    const kind = waitingKind(r)
    const you = needsYou(r)
    expect(isLive(status)).toBe(true)
    // Sino e lista lateral: espera você ⇔ item de espera.
    expect(flowWaitingItem(r, TASK) !== null).toBe(you)
    // Rodando ou na fila: aparece em "Rodando"; espera você não aparece lá.
    const running = buildRunning([], [r], () => TASK).length > 0
    // Fase 5: esperando a PR não é trabalho (a tarefa aparece pela PR, em Em revisão).
    expect(running).toBe(status === 'running' || (kind === 'queue' && reason !== 'waiting_pr'))
    expect(running && you).toBe(false)
    // Cartão de problema ⇔ problema.
    expect(describeFlowProblem(r) !== null).toBe(kind === 'problem')
    // Plano: problema = parou aqui; espera sua = esperando você; o resto = agora.
    const current = flowPlan(r).find((p) => p.id === r.currentStep)!
    expect(current.state).toBe(kind === 'problem' ? 'failed' : you ? 'waiting' : 'current')
  })

  it('as regras escolhidas por caso', () => {
    expect(needsYou(run('paused', 'waiting_slot'))).toBe(false)
    expect(needsYou(run('paused', 'waiting_agent'))).toBe(false)
    expect(waitingKind(run('paused', 'agent_daily_limit'))).toBe('problem')
    expect(waitingKind(run('paused', 'needs_choice'))).toBe('choice')
    expect(needsYou(run('running', null))).toBe(false)
    expect(isLive('finished')).toBe(false)
    expect(needsYou(run('finished', null))).toBe(false)
  })
})

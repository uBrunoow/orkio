import { describe, expect, it } from 'vitest'
import type { FlowRunView, FlowStepView, Step } from '../../../../shared/task-flow'
import {
  finalText,
  flowPlan,
  flowStepIndex,
  gateOutcomes,
  gateResultRunId,
  planProgress
} from './flow-plan'

const steps: Step[] = [
  {
    id: 'spec',
    name: 'Especificar',
    type: 'claude_command',
    command: 'alva-flow:spec',
    args: '',
    timeoutMin: 30
  },
  {
    id: 'pequeno',
    name: 'É pequeno?',
    type: 'branch',
    when: { type: 'var', key: 'x', op: 'exists' },
    then: '$fim'
  },
  {
    id: 'plan',
    name: 'Planejar',
    type: 'claude_command',
    command: 'alva-flow:plan',
    args: '',
    timeoutMin: 30
  },
  { id: 'ok', name: 'Aprovar plano', type: 'gate', message: 'Pode seguir?', show: 'backlog' },
  { id: 'push', name: 'Enviar', type: 'orkio_action', action: 'push' }
] as Step[]

function step(
  seq: number,
  stepId: string,
  status: FlowStepView['status'],
  runId: string | null = null
): FlowStepView {
  return {
    seq,
    stepId,
    runId,
    status,
    code: null,
    startedAt: `2026-11-23T10:0${seq}:00Z`,
    endedAt: status === 'running' || status === 'waiting' ? null : `2026-11-23T10:0${seq}:30Z`,
    message: null,
    costUsd: null
  }
}

function run(partial: Partial<FlowRunView>): FlowRunView {
  return {
    id: 'f1',
    projectId: 'p',
    taskId: 't',
    flowId: 'alva',
    flowName: 'Alva: planejar',
    steps,
    status: 'running',
    currentStep: 'spec',
    pauseReason: null,
    result: null,
    startedAt: '2026-11-23T10:00:00Z',
    endedAt: null,
    vars: {},
    history: [],
    choice: null,
    confirm: null,
    agent: null,
    revise: null,
    ...partial
  }
}

describe('flowPlan', () => {
  it('esconde os saltos e marca feito, agora e a seguir', () => {
    const plan = flowPlan(
      run({
        currentStep: 'plan',
        history: [step(1, 'spec', 'ok', 'r1'), step(2, 'plan', 'running', 'r2')]
      })
    )
    expect(plan.map((p) => [p.id, p.state])).toEqual([
      ['spec', 'done'],
      ['plan', 'current'],
      ['ok', 'next'],
      ['push', 'next']
    ])
    expect(plan[0]!.detail).toBe('/alva-flow:spec')
    expect(plan[2]!.detail).toBe('Sua aprovação')
    expect(plan[3]!.detail).toBe('Ação do Orkio: push')
    expect(planProgress(plan)).toEqual({ done: 1, total: 4 })
  })

  it('gate esperando é "esperando você"; passo que falhou e pausou é "falhou"', () => {
    expect(
      flowPlan(
        run({ status: 'waiting_gate', currentStep: 'ok', history: [step(1, 'ok', 'waiting')] })
      )[2]!.state
    ).toBe('waiting')
    expect(
      flowPlan(
        run({
          status: 'paused',
          pauseReason: 'step_failed',
          currentStep: 'plan',
          history: [step(1, 'spec', 'ok'), step(2, 'plan', 'failed')]
        })
      )[1]!.state
    ).toBe('failed')
    // Esperando vaga não é problema nem espera você: começa sozinho.
    expect(
      flowPlan(run({ status: 'paused', pauseReason: 'waiting_slot', currentStep: 'spec' }))[0]!
        .state
    ).toBe('current')
    // Limite diário do agente é problema (cartão com "Retomar"), não "esperando você".
    expect(
      flowPlan(run({ status: 'paused', pauseReason: 'agent_daily_limit', currentStep: 'spec' }))[0]!
        .state
    ).toBe('failed')
  })

  it('fluxo encerrado: passos que não rodaram ficam como não alcançados, não "a seguir"', () => {
    const plan = flowPlan(
      run({
        status: 'finished',
        result: 'done',
        currentStep: null,
        history: [step(1, 'spec', 'ok')]
      })
    )
    expect(plan.map((p) => p.state)).toEqual(['done', 'unreached', 'unreached', 'unreached'])
    expect(planProgress(plan)).toEqual({ done: 1, total: 1 })
  })

  it('conta as voltas de um passo', () => {
    const plan = flowPlan(
      run({
        currentStep: 'spec',
        history: [step(1, 'spec', 'ok'), step(2, 'spec', 'running')]
      })
    )
    expect(plan[0]).toMatchObject({ state: 'current', visits: 2 })
  })
})

describe('flowStepIndex', () => {
  it('liga cada execução ao passo, com posição, total e volta', () => {
    const index = flowStepIndex([
      run({
        agent: { key: 'builtin:implementador', name: 'Implementador', color: 'orange' },
        history: [
          step(1, 'spec', 'ok', 'r1'),
          step(2, 'spec', 'ok', 'r2'),
          step(3, 'plan', 'running', 'r3'),
          step(4, 'ok', 'waiting')
        ]
      })
    ])
    expect(index.get('r1')).toMatchObject({
      stepName: 'Especificar',
      position: 1,
      total: 4,
      visit: 1
    })
    expect(index.get('r2')).toMatchObject({ visit: 2 })
    expect(index.get('r3')).toMatchObject({
      stepName: 'Planejar',
      position: 2,
      flowName: 'Alva: planejar',
      agentName: 'Implementador'
    })
    expect(index.size).toBe(3)
  })
})

describe('gateOutcomes', () => {
  it('diz para onde aprovar e recusar levam', () => {
    expect(gateOutcomes(run({ status: 'waiting_gate', currentStep: 'ok' }))).toEqual({
      approve: 'Aprovar segue para “Enviar”.',
      reject: 'Recusar encerra o fluxo.'
    })
    const back = steps.map((s) => (s.id === 'ok' ? { ...s, onReject: 'plan' } : s)) as Step[]
    expect(gateOutcomes(run({ steps: back, currentStep: 'ok' }))?.reject).toBe(
      'Recusar volta para “Planejar”.'
    )
    expect(gateOutcomes(run({ currentStep: 'spec' }))).toBeNull()
  })
})

describe('resultado mostrado no gate', () => {
  it('a execução mais recente do fluxo antes do gate; sem execução, nada', () => {
    expect(
      gateResultRunId(
        run({
          status: 'waiting_gate',
          currentStep: 'ok',
          history: [
            step(1, 'spec', 'ok', 'r1'),
            step(2, 'plan', 'ok', 'r2'),
            step(3, 'ok', 'waiting')
          ]
        })
      )
    ).toBe('r2')
    expect(gateResultRunId(run({ history: [step(1, 'ok', 'waiting')] }))).toBeNull()
  })

  it('texto final: o resultado; sem ele, a última mensagem do Claude', () => {
    expect(
      finalText([
        { kind: 'text', text: 'pensando' },
        { kind: 'result', ok: true, durationMs: 1, costUsd: null, turns: 1, text: '1. Plano' }
      ])
    ).toBe('1. Plano')
    expect(
      finalText([
        { kind: 'text', text: '1. Plano' },
        { kind: 'result', ok: true, durationMs: 1, costUsd: null, turns: 1, text: '' }
      ])
    ).toBe('1. Plano')
    expect(finalText([])).toBeNull()
  })

  it('pedido em texto aparece no plano como pedido (sem barra de comando)', () => {
    const promptSteps: Step[] = [
      {
        id: 'plano',
        name: 'Plano',
        type: 'claude_command',
        command: '',
        args: '',
        prompt: 'Leia .orkio/revisao.md',
        readOnly: true,
        timeoutMin: 30
      }
    ]
    expect(flowPlan(run({ steps: promptSteps, currentStep: 'plano' }))[0]?.detail).toBe(
      'Pedido ao Claude Code (só leitura)'
    )
  })
})

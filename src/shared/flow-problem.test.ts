import { describe, expect, it } from 'vitest'
import { DELIVERY_MESSAGES } from './delivery'
import type { FlowRunView, FlowStepView, Step } from './task-flow'
import { classifyMessage, describeFlowProblem } from './flow-problem'

const STEPS: Step[] = [
  {
    id: 'commit',
    name: 'Commit (/commit)',
    type: 'claude_command',
    command: 'alva-flow:commit',
    args: '',
    timeoutMin: 15
  },
  { id: 'push', name: 'Push da branch (Orkio)', type: 'orkio_action', action: 'push' }
]

const entry = (over: Partial<FlowStepView>): FlowStepView => ({
  seq: 1,
  stepId: 'push',
  runId: null,
  status: 'failed',
  startedAt: '2026-11-21T10:00:00Z',
  endedAt: '2026-11-21T10:00:01Z',
  message: null,
  costUsd: null,
  ...over
})

function run(over: Partial<FlowRunView>): FlowRunView {
  return {
    id: 'fr-1',
    projectId: 'p',
    taskId: 't',
    flowId: 'f',
    flowName: 'Alva',
    steps: STEPS,
    status: 'paused',
    currentStep: 'push',
    pauseReason: 'step_failed',
    result: null,
    startedAt: '2026-11-21T10:00:00Z',
    endedAt: null,
    vars: {},
    history: [],
    choice: null,
    confirm: null,
    agent: null,
    ...over
  }
}

describe('classifyMessage', () => {
  it('reconhece os textos reais do app', () => {
    expect(classifyMessage(DELIVERY_MESSAGES.dirty)).toBe('uncommitted')
    expect(classifyMessage('O git pediu credenciais. Configure o acesso…')).toBe('credentials')
    expect(classifyMessage('O GitHub recusou o push: a branch remota tem commits…')).toBe(
      'push_rejected'
    )
    expect(classifyMessage('Tempo limite esgotado: o Orkio cancelou a execução.')).toBe('timed_out')
    expect(classifyMessage('O Claude Code terminou com erro: boom')).toBe('claude_error')
    expect(
      classifyMessage(
        'O /alva-flow:spec terminou sem criar nem alterar nenhuma task em backlog/tasks/. Confira o log'
      )
    ).toBe('no_task')
    expect(classifyMessage('Qualquer outra coisa')).toBe('generic')
    expect(classifyMessage(null)).toBe('generic')
  })
})

describe('describeFlowProblem', () => {
  it('push recusado por mudanças não commitadas: causa, motivo e "rodar o /commit de novo"', () => {
    const p = describeFlowProblem(run({ history: [entry({ message: DELIVERY_MESSAGES.dirty })] }))
    expect(p).toMatchObject({
      kind: 'uncommitted',
      title: 'Um passo falhou — Push da branch (Orkio)',
      reason: DELIVERY_MESSAGES.dirty,
      stepName: 'Push da branch (Orkio)',
      rerun: { stepId: 'commit', label: 'Rodar /commit de novo' }
    })
    expect(p?.hint).toContain('commit')
  })

  it('falha de comando: guarda a execução para abrir a sessão; não sugere rodar outro passo', () => {
    const p = describeFlowProblem(
      run({
        currentStep: 'commit',
        history: [
          entry({
            stepId: 'commit',
            runId: 'run-9',
            message: 'O Claude Code terminou com erro.'
          })
        ]
      })
    )
    expect(p).toMatchObject({ kind: 'claude_error', runId: 'run-9', rerun: null })
  })

  it('usa a falha mais recente do passo atual', () => {
    const p = describeFlowProblem(
      run({
        history: [
          entry({ seq: 1, message: DELIVERY_MESSAGES.dirty }),
          entry({ seq: 2, message: 'O git pediu credenciais.' })
        ]
      })
    )
    expect(p?.kind).toBe('credentials')
  })

  it('passo que usa a task do Backlog sem vínculo: explica e oferece rodar o /spec de novo', () => {
    const spec: Step = {
      id: 'spec',
      name: 'Especificar (/spec)',
      type: 'claude_command',
      command: 'alva-flow:spec',
      args: '{{alva.spec_arg}}',
      timeoutMin: 120
    }
    const plan: Step = {
      id: 'plan',
      name: 'Planejar (/plan)',
      type: 'claude_command',
      command: 'alva-flow:plan',
      args: '{{alva.task_id}}',
      timeoutMin: 60
    }
    const p = describeFlowProblem(
      run({
        steps: [spec, plan],
        currentStep: 'plan',
        history: [
          entry({
            stepId: 'plan',
            message:
              'Este passo usa a task do Backlog, mas o fluxo ainda não sabe qual é a desta tarefa.'
          })
        ]
      })
    )
    expect(p).toMatchObject({
      kind: 'no_link',
      rerun: { stepId: 'spec', label: 'Rodar /spec de novo' }
    })
    expect(p?.hint).toContain('/spec')
  })

  it('interrupção, limite de passos, prazo do gate e limite do agente', () => {
    expect(describeFlowProblem(run({ pauseReason: 'interrupted' }))?.kind).toBe('interrupted')
    expect(describeFlowProblem(run({ pauseReason: 'loop_guard' }))?.kind).toBe('loop_guard')
    expect(describeFlowProblem(run({ pauseReason: 'gate_timeout' }))?.kind).toBe('gate_timeout')
    expect(describeFlowProblem(run({ pauseReason: 'agent_daily_limit' }))?.kind).toBe('daily_limit')
  })

  it('espera por vaga ou por escolha, e fluxos que não estão pausados, não são problema', () => {
    for (const pauseReason of ['waiting_slot', 'waiting_agent', 'needs_choice'] as const) {
      expect(describeFlowProblem(run({ pauseReason }))).toBeNull()
    }
    expect(describeFlowProblem(run({ status: 'running', pauseReason: null }))).toBeNull()
  })
})

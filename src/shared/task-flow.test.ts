import { describe, expect, it } from 'vitest'
import {
  FLOW_END,
  MAX_EXECUTED_STEPS,
  afterStep,
  evaluateCondition,
  initialState,
  newStepId,
  renderArgs,
  retryStep,
  skipStep,
  startFlow,
  validateTaskFlow,
  type Flow,
  type FlowDecision,
  type Step
} from './task-flow'

const cmd = (id: string, command = 'revisar'): Step => ({
  id,
  name: id,
  type: 'claude_command',
  command,
  args: '',
  timeoutMin: 30
})
const gate = (id: string, onReject: string = 'stop'): Step => ({
  id,
  name: id,
  type: 'gate',
  message: 'Aprovar?',
  show: 'diff',
  onReject,
  timeoutMin: null
})

function runId(d: FlowDecision): string {
  if (d.kind !== 'run') throw new Error(`esperava run, veio ${d.kind}`)
  return d.stepId
}

describe('motor de fluxos', () => {
  it('sequência: roda cada passo em ordem e conclui', () => {
    const flow: Flow = { id: 'f', name: 'F', steps: [cmd('a'), gate('g'), cmd('b')] }
    let d = startFlow(flow)
    expect(runId(d)).toBe('a')
    d = afterStep(flow, d.state, 'a', { outcome: 'ok' })
    expect(runId(d)).toBe('g')
    d = afterStep(flow, d.state, 'g', { outcome: 'approved' })
    expect(runId(d)).toBe('b')
    d = afterStep(flow, d.state, 'b', { outcome: 'ok' })
    expect(d).toMatchObject({ kind: 'finished', result: 'done' })
  })

  it('falha pausa e não segue sozinha; pular conta como falho; retomar repete o passo', () => {
    const flow: Flow = {
      id: 'f',
      name: 'F',
      steps: [
        cmd('a'),
        {
          id: 'se',
          name: 'se',
          type: 'branch',
          when: { type: 'step', step: 'a', is: 'failed' },
          then: 'conserta'
        },
        cmd('fim'),
        cmd('conserta')
      ]
    }
    const s0 = startFlow(flow)
    const failed = afterStep(flow, s0.state, 'a', { outcome: 'failed' })
    expect(failed).toMatchObject({ kind: 'paused', reason: 'step_failed', stepId: 'a' })
    // Retomar: mesmo passo, mais uma visita.
    const retried = retryStep(flow, failed.state, 'a')
    expect(runId(retried)).toBe('a')
    expect(retried.state.visits['a']).toBe(2)
    // Pular: a condição enxerga "falhou" e salta.
    expect(runId(skipStep(flow, failed.state, 'a', 'failed'))).toBe('conserta')
    // Sucesso: o salto não acontece e segue a sequência.
    expect(runId(afterStep(flow, s0.state, 'a', { outcome: 'ok' }))).toBe('fim')
  })

  it('branch com limite de voltas (máx. 2) e variáveis gravadas pelo passo', () => {
    const flow: Flow = {
      id: 'f',
      name: 'F',
      steps: [
        cmd('revisar'),
        {
          id: 'de-novo',
          name: 'de novo',
          type: 'branch',
          when: {
            type: 'all',
            of: [
              { type: 'var', key: 'resultado', op: 'eq', value: 'mudancas' },
              { type: 'visits', step: 'revisar', lt: 2 }
            ]
          },
          then: 'revisar'
        },
        cmd('fim')
      ]
    }
    let d = startFlow(flow)
    d = afterStep(flow, d.state, 'revisar', { outcome: 'ok', vars: { resultado: 'mudancas' } })
    expect(runId(d)).toBe('revisar') // 1ª volta
    d = afterStep(flow, d.state, 'revisar', { outcome: 'ok', vars: { resultado: 'mudancas' } })
    expect(runId(d)).toBe('fim') // limite atingido
    expect(d.state.visits['revisar']).toBe(2)
    expect(d.state.vars).toEqual({ resultado: 'mudancas' })
  })

  it('gate recusado: vai para onReject ou encerra como recusado', () => {
    const loop: Flow = { id: 'f', name: 'F', steps: [cmd('fazer'), gate('ok?', 'fazer')] }
    let d = startFlow(loop)
    d = afterStep(loop, d.state, 'fazer', { outcome: 'ok' })
    expect(runId(afterStep(loop, d.state, 'ok?', { outcome: 'rejected' }))).toBe('fazer')
    const stop: Flow = { id: 'f', name: 'F', steps: [gate('ok?')] }
    expect(afterStep(stop, startFlow(stop).state, 'ok?', { outcome: 'rejected' })).toMatchObject({
      kind: 'finished',
      result: 'rejected'
    })
  })

  it('trava de segurança: muitos passos executados pausa o fluxo', () => {
    const flow: Flow = { id: 'f', name: 'F', steps: [cmd('a'), gate('g', 'a')] }
    let d = startFlow(flow)
    let guard = 0
    while (d.kind === 'run' && guard++ < 200) {
      d = afterStep(flow, d.state, d.stepId, {
        outcome: d.stepId === 'g' ? 'rejected' : 'ok'
      })
    }
    expect(d).toMatchObject({ kind: 'paused', reason: 'loop_guard' })
    expect(d.state.executed).toBe(MAX_EXECUTED_STEPS)
  })

  it('condições: var eq/neq/exists e any', () => {
    const s = { ...initialState(), vars: { a: '1', b: '' } }
    expect(evaluateCondition({ type: 'var', key: 'a', op: 'eq', value: '1' }, s)).toBe(true)
    expect(evaluateCondition({ type: 'var', key: 'a', op: 'neq', value: '1' }, s)).toBe(false)
    expect(evaluateCondition({ type: 'var', key: 'b', op: 'exists' }, s)).toBe(false)
    expect(
      evaluateCondition(
        {
          type: 'any',
          of: [
            { type: 'var', key: 'x', op: 'exists' },
            { type: 'visits', step: 'q', lt: 1 }
          ]
        },
        s
      )
    ).toBe(true)
  })

  it('template: variáveis conhecidas, do fluxo e ausentes', () => {
    expect(
      renderArgs('{{task_id}} {{ briefing_path }} {{flow.pr}} {{notion_url}} {{nada}}', {
        briefingPath: '.orkio/briefing.md',
        taskId: 'ORK-2',
        notionUrl: null,
        vars: { pr: '45' }
      })
    ).toEqual({ text: 'ORK-2 .orkio/briefing.md 45  ', missing: ['notion_url', 'nada'] })
  })

  it('validação: salto inexistente, loop sem limite, comando não instalado, extrator', () => {
    const ctx = { commands: new Set(['revisar']), extractors: ['linhas_orkio'], actions: ['noop'] }
    const flow: Flow = {
      id: 'f',
      name: 'F',
      steps: [
        cmd('a', 'nao-instalado'),
        {
          id: 'volta',
          name: 'volta',
          type: 'branch',
          when: { type: 'var', key: 'x', op: 'exists' },
          then: 'a'
        },
        {
          id: 'pula',
          name: 'pula',
          type: 'branch',
          when: { type: 'step', step: 'a', is: 'ok' },
          then: 'zzz'
        },
        { ...(cmd('b') as Extract<Step, { type: 'claude_command' }>), extract: { extractor: 'x' } },
        { id: 'acao', name: 'acao', type: 'orkio_action', action: 'push' }
      ]
    }
    const issues = validateTaskFlow(flow, ctx)
    expect(issues.filter((i) => i.level === 'warning').map((i) => i.stepId)).toEqual(['a'])
    expect(issues.filter((i) => i.level === 'error').map((i) => i.stepId)).toEqual([
      'volta',
      'pula',
      'b',
      'acao'
    ])
    // Com limite de voltas, a volta passa a ser válida.
    const ok: Flow = {
      ...flow,
      steps: [
        cmd('a'),
        {
          id: 'volta',
          name: 'volta',
          type: 'branch',
          when: { type: 'all', of: [{ type: 'visits', step: 'a', lt: 2 }] },
          then: 'a'
        }
      ]
    }
    expect(validateTaskFlow(ok, ctx)).toEqual([])
  })

  it('newStepId: slug sem acento e único', () => {
    const flow: Flow = { id: 'f', name: 'F', steps: [cmd('revisao')] }
    expect(newStepId(flow, 'Revisão')).toBe('revisao-2')
    expect(newStepId(flow, 'Aprovação final!')).toBe('aprovacao-final')
  })

  it('salto para $fim encerra o fluxo (válido na validação)', () => {
    const flow: Flow = {
      id: 'f',
      name: 'F',
      steps: [
        cmd('a'),
        { id: 'sai', name: 'sai', type: 'branch', when: { type: 'all', of: [] }, then: FLOW_END },
        cmd('nunca')
      ]
    }
    const d = afterStep(flow, startFlow(flow).state, 'a', { outcome: 'ok' })
    expect(d).toMatchObject({ kind: 'finished', result: 'done' })
    expect(validateTaskFlow(flow, { commands: null, extractors: [], actions: [] })).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  FLOW_END,
  MAX_EXECUTED_STEPS,
  afterStep,
  evaluateCondition,
  initialState,
  newStepId,
  renderArgs,
  renderMessage,
  retryStep,
  reviseGate,
  skipStep,
  startFlow,
  validateTaskFlow,
  type Flow,
  type FlowDecision,
  type Step
} from './task-flow'

/** Sem saídas declaradas: o validador não confere namespaces. */
const NO_VARS: ReadonlySet<string> = new Set()

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
    const ctx = {
      commands: new Set(['revisar']),
      extractors: ['linhas_orkio'],
      actions: ['noop'],
      declaredVars: NO_VARS
    }
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

  it('validação: chave de um namespace do Orkio que ninguém grava é aviso (condição, args, gate)', () => {
    const ctx = {
      commands: null,
      extractors: [],
      actions: [],
      declaredVars: new Set(['pr.pushed', 'review.pr'])
    }
    const flow: Flow = {
      id: 'f',
      name: 'F',
      steps: [
        { ...(cmd('a') as Extract<Step, { type: 'claude_command' }>), args: '{{flow.pr.numero}}' },
        {
          id: 'ja',
          name: 'ja',
          type: 'branch',
          when: { type: 'var', key: 'pr.pushd', op: 'eq', value: 'sim' },
          then: FLOW_END
        },
        {
          id: 'g',
          name: 'g',
          type: 'gate',
          message: 'PR #{{review.pr}} e {{review.total}}',
          show: 'none',
          onReject: 'stop',
          timeoutMin: null
        },
        // Namespace que o Orkio não grava (do usuário): sem aviso.
        {
          id: 'meu',
          name: 'meu',
          type: 'branch',
          when: { type: 'var', key: 'meu.valor', op: 'exists' },
          then: FLOW_END
        }
      ]
    }
    const warnings = validateTaskFlow(flow, ctx).filter((i) => i.level === 'warning')
    expect(warnings.map((i) => [i.stepId, i.message])).toEqual([
      ['a', expect.stringContaining('pr.numero')],
      ['ja', expect.stringContaining('pr.pushd')],
      ['g', expect.stringContaining('review.total')]
    ])
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
    expect(
      validateTaskFlow(flow, { commands: null, extractors: [], actions: [], declaredVars: NO_VARS })
    ).toEqual([])
  })
})

describe('validateTaskFlow: modelo e raciocínio do passo', () => {
  const ctx = { commands: null, extractors: [], actions: [], declaredVars: NO_VARS }
  const flowWith = (extra: Record<string, unknown>): Flow => ({
    id: 'f',
    name: 'f',
    steps: [
      {
        id: 'a',
        name: 'A',
        type: 'claude_command',
        command: 'x',
        args: '',
        timeoutMin: 5,
        ...extra
      } as Step
    ]
  })
  it('aceita modelo e raciocínio válidos e recusa modelo inválido', () => {
    expect(validateTaskFlow(flowWith({ model: 'opus', effort: 'low' }), ctx)).toEqual([])
    const bad = validateTaskFlow(flowWith({ model: '--x' }), ctx)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ level: 'error', stepId: 'a' })
    expect(bad[0]!.message).toContain('modelo inválido')
    expect(validateTaskFlow(flowWith({ effort: 'ultra' }), ctx)[0]?.level).toBe('error')
  })
})

describe('pedido em texto, só leitura e "Pedir ajustes"', () => {
  const ctx = { commands: new Set(['revisar']), extractors: [], actions: [], declaredVars: NO_VARS }
  const prompt = (id: string, extra: Record<string, unknown> = {}): Step =>
    ({
      id,
      name: id,
      type: 'claude_command',
      command: '',
      args: '',
      prompt: 'Leia .orkio/revisao.md da PR #{{review.pr}}.',
      timeoutMin: 30,
      ...extra
    }) as Step
  const reviseGateStep = (extra: Record<string, unknown> = {}): Step =>
    ({
      id: 'ok',
      name: 'ok',
      type: 'gate',
      message: 'Aprovar correções da PR #{{review.pr}}',
      show: 'result',
      onReject: 'stop',
      timeoutMin: null,
      revise: { step: 'plano', max: 3 },
      ...extra
    }) as Step
  const flowOf = (...steps: Step[]): Flow => ({ id: 'f', name: 'f', steps })
  const errors = (flow: Flow): string[] =>
    validateTaskFlow(flow, ctx)
      .filter((i) => i.level === 'error')
      .map((i) => i.message)

  it('exatamente um de comando ou pedido; só leitura não combina com entrega', () => {
    expect(validateTaskFlow(flowOf(prompt('plano', { readOnly: true })), ctx)).toEqual([])
    expect(errors(flowOf(prompt('a', { command: 'revisar' })))).toEqual([
      'Passo “a”: use um comando ou um pedido em texto, não os dois.'
    ])
    expect(errors(flowOf(prompt('a', { prompt: '  ' })))).toEqual([
      'Passo “a”: escreva o pedido para o Claude Code.'
    ])
    expect(errors(flowOf(cmd('a', '')))).toEqual(['Passo “a”: escolha o comando.'])
    expect(errors(flowOf(prompt('a', { readOnly: true, delivery: true })))).toEqual([
      'Passo “a”: um passo só de leitura não pode estar em modo entrega.'
    ])
    expect(errors(flowOf(prompt('a', { prompt: 'x'.repeat(8001) })))[0]).toContain('8000')
    // Variável desconhecida no pedido avisa, como nos argumentos.
    expect(validateTaskFlow(flowOf(prompt('a', { prompt: '{{nada}}' })), ctx)).toMatchObject([
      { level: 'warning', stepId: 'a' }
    ])
  })

  it('"Pedir ajustes" precisa voltar a um passo do Claude Code antes do gate, com limite 1..10', () => {
    expect(validateTaskFlow(flowOf(prompt('plano'), reviseGateStep()), ctx)).toEqual([])
    expect(errors(flowOf(reviseGateStep(), prompt('plano')))).toEqual([
      'Passo “ok”: “pedir ajustes” precisa voltar a um passo do Claude Code antes do gate.'
    ])
    expect(
      errors(flowOf(prompt('plano'), reviseGateStep({ revise: { step: 'nada', max: 3 } })))
    ).toEqual(['Passo “ok”: “pedir ajustes” aponta para um passo que não existe (nada).'])
    expect(
      errors(flowOf(prompt('plano'), reviseGateStep({ revise: { step: 'plano', max: 0 } })))
    ).toEqual(['Passo “ok”: o limite de ajustes deve ficar entre 1 e 10.'])
    // Mostrar o resultado sem um passo do Claude Code antes: aviso.
    expect(
      validateTaskFlow(flowOf(reviseGateStep({ revise: undefined }), prompt('plano')), ctx)
    ).toMatchObject([{ level: 'warning', stepId: 'ok' }])
  })

  it('reviseGate conta as voltas, volta ao passo e recusa depois do limite', () => {
    const flow = flowOf(prompt('plano'), reviseGateStep({ revise: { step: 'plano', max: 2 } }))
    let d = startFlow(flow)
    d = afterStep(flow, d.state, 'plano', { outcome: 'ok' })
    expect(runId(d)).toBe('ok')
    for (let i = 1; i <= 2; i++) {
      const r = reviseGate(flow, d.state, 'ok')
      if (r.kind === 'refused') throw new Error('recusou cedo')
      expect(runId(r)).toBe('plano')
      expect(r.state.revisions).toEqual({ ok: i })
      d = afterStep(flow, r.state, 'plano', { outcome: 'ok' })
    }
    expect(reviseGate(flow, d.state, 'ok')).toEqual({ kind: 'refused', reason: 'limit', max: 2 })
    // Gate sem ajustes (ou passo que não é gate): recusado.
    expect(reviseGate(flowOf(gate('g')), initialState(), 'g')).toMatchObject({
      kind: 'refused',
      reason: 'not_revisable'
    })
    // Aprovar segue normalmente depois das voltas.
    expect(afterStep(flow, d.state, 'ok', { outcome: 'approved' })).toMatchObject({
      kind: 'finished',
      result: 'done'
    })
  })

  it('renderMessage troca as variáveis do fluxo; sem valor vira …', () => {
    expect(renderMessage('PR #{{review.pr}} · {{flow.x}}', { 'review.pr': '13', x: 'a' })).toBe(
      'PR #13 · a'
    )
    expect(renderMessage('PR #{{review.pr}} {{task_id}}', {})).toBe('PR #… …')
  })
})

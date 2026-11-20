import { describe, expect, it } from 'vitest'
import { alvaDeliverFlow, alvaPlanFlow, alvaReviewedFlow, alvaTemplates } from './alva-templates'
import { afterStep, startFlow, validateTaskFlow, type Flow, type FlowDecision } from './task-flow'

const CTX = {
  commands: new Set(
    ['spec', 'plan', 'implement', 'review', 'fix', 'commit', 'pr'].map((c) => `alva-flow:${c}`)
  ),
  extractors: ['alva'],
  actions: ['noop', 'push', 'verify_pushed', 'request_review']
}

/** Roda o motor: `outcomes[stepId]` dá as variáveis que o extrator gravaria a cada execução. */
function simulate(
  flow: Flow,
  initial: Record<string, string>,
  onStep: (
    stepId: string,
    n: number
  ) => { vars?: Record<string, string>; gate?: 'approved' | 'rejected' }
): { trail: string[]; end: FlowDecision } {
  const trail: string[] = []
  const count: Record<string, number> = {}
  let d = startFlow(flow, initial)
  while (d.kind === 'run' && trail.length < 60) {
    const id = d.stepId
    trail.push(id)
    count[id] = (count[id] ?? 0) + 1
    const r = onStep(id, count[id]!)
    const step = flow.steps.find((s) => s.id === id)!
    d =
      step.type === 'gate'
        ? afterStep(flow, d.state, id, { outcome: r.gate === 'rejected' ? 'rejected' : 'approved' })
        : afterStep(flow, d.state, id, { outcome: 'ok', ...(r.vars ? { vars: r.vars } : {}) })
  }
  return { trail, end: d }
}

describe('templates do alva-flow', () => {
  it('todos passam no validador da 5A (sem erros nem avisos)', () => {
    for (const flow of alvaTemplates()) expect(validateTaskFlow(flow, CTX)).toEqual([])
    // Comandos sem o briefing nos argumentos.
    const cmds = alvaTemplates()
      .flatMap((f) => f.steps)
      .filter((s) => s.type === 'claude_command')
    expect(cmds.every((s) => s.type === 'claude_command' && s.includeBriefing === false)).toBe(true)
  })

  it('Planejar: caminho Pequeno termina depois do /spec (pula o plano)', () => {
    const { trail, end } = simulate(alvaPlanFlow(), { 'alva.linked': 'nao' }, (id) =>
      id === 'spec' ? { vars: { 'alva.status': 'Reviewed', 'alva.open_questions': '0' } } : {}
    )
    expect(trail).toEqual(['spec'])
    expect(end).toMatchObject({ kind: 'finished', result: 'done' })
  })

  it('Planejar: Médio vai ao /plan e ao gate; perguntas em aberto voltam ao /spec', () => {
    const { trail } = simulate(alvaPlanFlow(), {}, (id, n) =>
      id === 'spec'
        ? {
            vars: {
              'alva.status': 'Requirements Defined',
              'alva.open_questions': n === 1 ? '2' : '0'
            }
          }
        : {}
    )
    expect(trail).toEqual(['spec', 'perguntas', 'spec', 'plan', 'aprovar-plano'])
  })

  it('Entregar com vínculo: implement → review → blocker volta ao fix no MÁXIMO 2 vezes', () => {
    const { trail, end } = simulate(
      alvaDeliverFlow(),
      { 'alva.linked': 'sim', 'alva.task_id': 'TASK-1', 'alva.status': 'Architected' },
      (id) => (id === 'review' ? { vars: { 'alva.review_blocker': 'sim' } } : {})
    )
    expect(trail).toEqual([
      'implement',
      'review',
      'fix',
      'review',
      'fix',
      'review',
      'ver-diff',
      'commit',
      'push',
      'pr'
    ])
    expect(end).toMatchObject({ kind: 'finished', result: 'done' })
  })

  it('Entregar sem vínculo roda /spec e /plan; caminho Pequeno vai direto ao diff', () => {
    const plain = simulate(alvaDeliverFlow(), { 'alva.linked': 'nao' }, (id) =>
      id === 'spec'
        ? { vars: { 'alva.linked': 'sim', 'alva.status': 'Requirements Defined' } }
        : id === 'review'
          ? { vars: { 'alva.review_blocker': 'nao' } }
          : {}
    )
    expect(plain.trail.slice(0, 5)).toEqual(['spec', 'plan', 'implement', 'review', 'ver-diff'])
    const small = simulate(alvaDeliverFlow(), { 'alva.linked': 'nao' }, (id) =>
      id === 'spec' ? { vars: { 'alva.linked': 'sim', 'alva.status': 'Reviewed' } } : {}
    )
    expect(small.trail.slice(0, 2)).toEqual(['spec', 'ver-diff']) // Pequeno pula o plano
  })

  it('/pr e /pr --comments em modo entrega; nenhum outro passo tem o modo', () => {
    const delivery = alvaTemplates()
      .flatMap((f) => f.steps.map((s) => ({ f: f.id, s })))
      .filter(({ s }) => s.type === 'claude_command' && s.delivery)
      .map(({ f, s }) => `${f}:${s.id}`)
    expect(delivery).toEqual(['alva-entregar:pr', 'alva-revisado:comentarios'])
  })

  it('Revisado: já enviado → pede review; não enviado → push do Orkio antes', () => {
    const pushed = simulate(alvaReviewedFlow(), {}, (id) =>
      id === 'conferir-push' ? { vars: { 'pr.pushed': 'sim' } } : {}
    )
    expect(pushed.trail).toEqual(['comentarios', 'conferir-push', 'pedir-review'])
    const notPushed = simulate(alvaReviewedFlow(), {}, (id) =>
      id === 'conferir-push' ? { vars: { 'pr.pushed': 'nao' } } : {}
    )
    expect(notPushed.trail).toEqual(['comentarios', 'conferir-push', 'push', 'pedir-review'])
  })

  it('recusar o diff encerra antes do commit', () => {
    const { trail, end } = simulate(
      alvaDeliverFlow(),
      { 'alva.linked': 'sim', 'alva.status': 'Reviewed' },
      (id) => (id === 'ver-diff' ? { gate: 'rejected' } : {})
    )
    expect(trail).toEqual(['ver-diff'])
    expect(end).toMatchObject({ kind: 'finished', result: 'rejected' })
  })
})

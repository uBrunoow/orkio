import { describe, expect, it } from 'vitest'
import {
  alvaDeliverFlow,
  alvaOpenPrFlow,
  alvaPlanFlow,
  alvaReviewedFlow,
  alvaReviewPublishFlow,
  alvaTemplates,
  ALVA_TEMPLATE_IDS,
  OPEN_PR_FLOW_IDS,
  REVIEW_JSON_PROMPT,
  sendBranchFlow,
  upgradeAlvaFlows
} from './alva-templates'
import {
  afterStep,
  reviseGate,
  startFlow,
  validateTaskFlow,
  type Flow,
  type FlowDecision
} from './task-flow'

const CTX = {
  commands: new Set(
    ['spec', 'plan', 'implement', 'review', 'fix', 'commit', 'pr'].map((c) => `alva-flow:${c}`)
  ),
  extractors: ['alva'],
  actions: ['noop', 'push', 'verify_pushed', 'request_review', 'review_snapshot', 'publish_review']
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
    // Comandos do plugin sem o briefing nos argumentos (pedidos em texto levam o briefing só
    // quando começam uma sessão nova).
    const cmds = alvaTemplates()
      .flatMap((f) => f.steps)
      .filter((s) => s.type === 'claude_command' && s.command !== '')
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
    expect(trail).toEqual(['spec', 'perguntas', 'spec', 'aprovar-spec', 'plan', 'aprovar-plano'])
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

  it('Entregar sem vínculo roda /spec e /plan, cada um com a sua aprovação; caminho Pequeno vai direto ao diff', () => {
    const plain = simulate(alvaDeliverFlow(), { 'alva.linked': 'nao' }, (id) =>
      id === 'spec'
        ? { vars: { 'alva.linked': 'sim', 'alva.status': 'Requirements Defined' } }
        : id === 'review'
          ? { vars: { 'alva.review_blocker': 'nao' } }
          : {}
    )
    expect(plain.trail.slice(0, 7)).toEqual([
      'spec',
      'aprovar-spec',
      'plan',
      'aprovar-plano',
      'implement',
      'review',
      'ver-diff'
    ])
    const small = simulate(alvaDeliverFlow(), { 'alva.linked': 'nao' }, (id) =>
      id === 'spec' ? { vars: { 'alva.linked': 'sim', 'alva.status': 'Reviewed' } } : {}
    )
    expect(small.trail.slice(0, 2)).toEqual(['spec', 'ver-diff']) // Pequeno pula o plano
  })

  it('/pr e aplicar correções em modo entrega; nenhum outro passo tem o modo', () => {
    const delivery = alvaTemplates()
      .flatMap((f) => f.steps.map((s) => ({ f: f.id, s })))
      .filter(({ s }) => s.type === 'claude_command' && s.delivery)
      .map(({ f, s }) => `${f}:${s.id}`)
    expect(delivery).toEqual(['alva-entregar:pr', 'alva-revisado:aplicar-correcoes'])
  })

  const reviewVars = (id: string): { vars?: Record<string, string> } =>
    id === 'ler-comentarios'
      ? { vars: { 'review.count': '2', 'review.pr': '13' } }
      : id === 'conferir-push'
        ? { vars: { 'pr.pushed': 'nao' } }
        : {}

  it('Revisado: comentários → plano (só leitura) → aprovar → aplicar → push → pedir review', () => {
    const { trail, end } = simulate(alvaReviewedFlow(), {}, reviewVars)
    expect(trail).toEqual([
      'ler-comentarios',
      'plano-correcoes',
      'aprovar-correcoes',
      'aplicar-correcoes',
      'conferir-push',
      'push',
      'pedir-review'
    ])
    expect(end).toMatchObject({ kind: 'finished', result: 'done' })
    const steps = alvaReviewedFlow().steps
    expect(steps.find((s) => s.id === 'plano-correcoes')).toMatchObject({
      command: '',
      readOnly: true,
      prompt: expect.stringContaining('.orkio/revisao.md') as string
    })
    expect(steps.find((s) => s.id === 'aprovar-correcoes')).toMatchObject({
      show: 'result',
      message: 'Aprovar correções da PR #{{review.pr}}',
      onReject: 'stop',
      revise: { step: 'plano-correcoes', max: 3 }
    })
    const pushed = simulate(alvaReviewedFlow(), {}, (id) =>
      id === 'conferir-push' ? { vars: { 'pr.pushed': 'sim' } } : reviewVars(id)
    )
    expect(pushed.trail.slice(-2)).toEqual(['conferir-push', 'pedir-review'])
  })

  it('Revisado: sem comentários pendentes termina; recusar o plano encerra sem corrigir', () => {
    const none = simulate(alvaReviewedFlow(), {}, (id) =>
      id === 'ler-comentarios' ? { vars: { 'review.count': '0', 'review.pr': '13' } } : {}
    )
    expect(none.trail).toEqual(['ler-comentarios'])
    expect(none.end).toMatchObject({ kind: 'finished', result: 'done' })
    const rejected = simulate(alvaReviewedFlow(), {}, (id) =>
      id === 'aprovar-correcoes' ? { gate: 'rejected' } : reviewVars(id)
    )
    expect(rejected.trail).toEqual(['ler-comentarios', 'plano-correcoes', 'aprovar-correcoes'])
    expect(rejected.end).toMatchObject({ kind: 'finished', result: 'rejected' })
  })

  it('Revisado: "Pedir ajustes" volta ao plano até 3 vezes', () => {
    const flow = alvaReviewedFlow()
    let d = startFlow(flow, {})
    d = afterStep(flow, d.state, 'ler-comentarios', {
      outcome: 'ok',
      vars: { 'review.count': '1', 'review.pr': '13' }
    })
    for (let round = 1; round <= 3; round++) {
      d = afterStep(flow, d.state, 'plano-correcoes', { outcome: 'ok' })
      expect(d).toMatchObject({ kind: 'run', stepId: 'aprovar-correcoes' })
      d = reviseGate(flow, d.state, 'aprovar-correcoes') as FlowDecision
      expect(d).toMatchObject({ kind: 'run', stepId: 'plano-correcoes' })
    }
    d = afterStep(flow, d.state, 'plano-correcoes', { outcome: 'ok' })
    expect(reviseGate(flow, d.state, 'aprovar-correcoes')).toEqual({
      kind: 'refused',
      reason: 'limit',
      max: 3
    })
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

describe('gates de spec e plano', () => {
  it('mostram a task do Backlog e recusar encerra', () => {
    for (const flow of [alvaPlanFlow(), alvaDeliverFlow()]) {
      for (const id of ['aprovar-spec', 'aprovar-plano']) {
        const step = flow.steps.find((s) => s.id === id)
        expect(step, `${flow.id}:${id}`).toMatchObject({
          type: 'gate',
          show: 'backlog',
          onReject: 'stop'
        })
      }
    }
  })

  it('recusar a spec encerra antes do /plan', () => {
    const { trail, end } = simulate(alvaPlanFlow(), {}, (id) =>
      id === 'spec'
        ? { vars: { 'alva.status': 'Requirements Defined', 'alva.open_questions': '0' } }
        : id === 'aprovar-spec'
          ? { gate: 'rejected' }
          : {}
    )
    expect(trail).toEqual(['spec', 'aprovar-spec'])
    expect(end).toMatchObject({ kind: 'finished', result: 'rejected' })
  })
})

describe('fluxos do botão "Abrir PR"', () => {
  it('push (Orkio) e /pr em modo entrega, válidos e fora dos templates', () => {
    const flow = alvaOpenPrFlow()
    expect(flow.id).toBe(OPEN_PR_FLOW_IDS.openPr)
    expect(flow.tags).toEqual(['alva'])
    expect(flow.steps.map((s) => s.id)).toEqual(['push', 'pr'])
    expect(flow.steps[0]).toMatchObject({ type: 'orkio_action', action: 'push' })
    expect(flow.steps[1]).toMatchObject({
      type: 'claude_command',
      command: 'alva-flow:pr',
      args: '{{alva.task_id}}',
      delivery: true
    })
    expect(validateTaskFlow(flow, CTX)).toEqual([])
    expect(alvaTemplates().map((f) => f.id)).not.toContain(flow.id)
  })

  it('branch já enviada: só o /pr, ainda em modo entrega', () => {
    const flow = alvaOpenPrFlow({ push: false })
    expect(flow.steps.map((s) => s.id)).toEqual(['pr'])
    expect(flow.steps[0]).toMatchObject({ delivery: true })
    expect(validateTaskFlow(flow, CTX)).toEqual([])
  })

  it('sem vínculo: só o push', () => {
    const flow = sendBranchFlow()
    expect(flow.steps).toHaveLength(1)
    expect(flow.tags).toBeUndefined()
    expect(validateTaskFlow(flow, CTX)).toEqual([])
  })
})

describe('Alva: revisão publicada (Task 18)', () => {
  it('/review → JSON só leitura (sessão do review) → publicar pelo Orkio', () => {
    const flow = alvaReviewPublishFlow()
    expect(flow.id).toBe(ALVA_TEMPLATE_IDS.review)
    expect(flow.tags).toEqual(['alva'])
    expect(flow.steps.map((s) => s.id)).toEqual(['review', 'revisao-json', 'publicar-revisao'])
    expect(flow.steps[0]).toMatchObject({ command: 'alva-flow:review', args: '{{alva.task_id}}' })
    expect(flow.steps[1]).toMatchObject({ prompt: REVIEW_JSON_PROMPT, readOnly: true })
    expect(flow.steps[1]).not.toHaveProperty('delivery')
    expect(flow.steps[2]).toMatchObject({ type: 'orkio_action', action: 'publish_review' })
    expect(validateTaskFlow(flow, CTX)).toEqual([])
    expect(alvaTemplates().map((f) => f.id)).toContain(flow.id)
    // As chaves do JSON não viram variáveis do template.
    expect(REVIEW_JSON_PROMPT).not.toContain('{{')
    expect(REVIEW_JSON_PROMPT).toContain('REQUEST_CHANGES')
  })
})

describe('upgradeAlvaFlows (ligações padrão e migração)', () => {
  const stages = [
    { id: 'st-prio', name: 'Prioridades' },
    { id: 'st-dev', name: 'Em andamento' },
    { id: 'st-rev', name: 'revisándo' },
    { id: 'st-ok', name: 'Revisado' }
  ]
  const userFlow: Flow = { id: 'meu-fluxo', name: 'Meu fluxo', steps: [] }

  it('sem modelos Alva no projeto: nada muda', () => {
    const pf = { flows: [userFlow], bindings: [] }
    const r = upgradeAlvaFlows(pf, stages)
    expect(r.changes).toEqual([])
    expect(r.flows).toBe(pf)
  })

  it('acrescenta os modelos que faltam e liga Revisando/Revisado vazias (sem acento/caixa)', () => {
    const old = { ...alvaPlanFlow(), steps: alvaPlanFlow().steps.slice(0, 1) }
    const pf = {
      flows: [old, userFlow],
      bindings: [
        { stageId: 'st-dev', flowId: 'meu-fluxo', enabled: true, mode: 'on_enter' as const }
      ]
    }
    const r = upgradeAlvaFlows(pf, stages)
    expect(r.flows.flows.find((f) => f.id === ALVA_TEMPLATE_IDS.plan)).toEqual(alvaPlanFlow())
    expect(r.flows.flows.find((f) => f.id === 'meu-fluxo')).toBe(userFlow)
    expect(r.flows.flows.map((f) => f.id).sort()).toEqual(
      [...alvaTemplates().map((f) => f.id), 'meu-fluxo', 'alva-planejar-anterior'].sort()
    )
    expect(r.flows.bindings).toEqual([
      { stageId: 'st-dev', flowId: 'meu-fluxo', enabled: true, mode: 'on_enter' },
      { stageId: 'st-rev', flowId: ALVA_TEMPLATE_IDS.review, enabled: true, mode: 'on_enter' },
      { stageId: 'st-ok', flowId: ALVA_TEMPLATE_IDS.reviewed, enabled: true, mode: 'on_enter' }
    ])
    expect(r.changes).toContain(
      'Fluxo “Alva: planejar” atualizado para a versão nova do modelo Alva'
    )
    expect(r.changes).toContain('Fluxo “Alva: revisão publicada” criado (modelo Alva)')
    expect(r.changes).toContain(
      'Coluna “revisándo” ganhou o fluxo “Alva: revisão publicada” (ao entrar)'
    )
  })

  it('cópia editada: guarda a sua versão (sem coluna) e só então troca pelo modelo novo', () => {
    const edited = {
      ...alvaDeliverFlow(),
      steps: alvaDeliverFlow().steps.map((st) =>
        st.id === 'implement' && st.type === 'claude_command' ? { ...st, timeoutMin: 240 } : st
      )
    }
    const pf = {
      flows: [edited, { ...userFlow, id: 'alva-entregar-anterior' }],
      bindings: [
        {
          stageId: 'st-dev',
          flowId: ALVA_TEMPLATE_IDS.deliver,
          enabled: true,
          mode: 'on_enter' as const
        }
      ]
    }
    const r = upgradeAlvaFlows(pf, stages)
    expect(r.flows.flows.find((f) => f.id === ALVA_TEMPLATE_IDS.deliver)).toEqual(alvaDeliverFlow())
    // "-anterior" já existe: a cópia vai para "-anterior-2", com o conteúdo de antes e sem coluna.
    const backup = r.flows.flows.find((f) => f.id === 'alva-entregar-anterior-2')
    expect(backup).toEqual({
      ...edited,
      id: 'alva-entregar-anterior-2',
      name: 'Alva: implementar e entregar (cópia anterior)'
    })
    expect(r.flows.bindings.some((b) => b.flowId === 'alva-entregar-anterior-2')).toBe(false)
    expect(r.flows.bindings[0]).toEqual(pf.bindings[0])
    expect(r.changes.slice(0, 2)).toEqual([
      'Cópia anterior de “Alva: implementar e entregar” guardada como “Alva: implementar e entregar (cópia anterior)” (sem coluna)',
      'Fluxo “Alva: implementar e entregar” atualizado para a versão nova do modelo Alva'
    ])
  })

  it('cópia igual ao modelo (mesmo com as chaves em outra ordem): nada muda', () => {
    const reordered = JSON.parse(
      JSON.stringify(alvaTemplates(), (_k, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse())
          : v
      )
    ) as Flow[]
    expect(Object.keys(reordered[0]!)).not.toEqual(Object.keys(alvaTemplates()[0]!))
    const pf = { flows: reordered, bindings: [] }
    const r = upgradeAlvaFlows(pf, [])
    expect(r.changes).toEqual([])
    expect(r.flows).toBe(pf)
  })

  it('nunca troca a ligação de uma coluna que já tem fluxo, nem liga um modelo já ligado', () => {
    const pf = {
      flows: [...alvaTemplates(), userFlow],
      bindings: [
        { stageId: 'st-rev', flowId: 'meu-fluxo', enabled: false, mode: 'manual' as const },
        {
          stageId: 'st-dev',
          flowId: ALVA_TEMPLATE_IDS.reviewed,
          enabled: true,
          mode: 'on_enter' as const
        }
      ]
    }
    const r = upgradeAlvaFlows(pf, stages)
    expect(r.flows.bindings).toEqual(pf.bindings)
    expect(r.changes).toEqual([])
    expect(r.flows).toBe(pf)
  })

  it('sem as colunas pelo nome: só os fluxos', () => {
    const pf = { flows: [alvaDeliverFlow()], bindings: [] }
    const r = upgradeAlvaFlows(pf, [{ id: 'a', name: 'Fazendo' }])
    expect(r.flows.bindings).toEqual([])
    expect(r.flows.flows).toHaveLength(alvaTemplates().length)
  })
})

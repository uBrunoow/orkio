import { describe, expect, it } from 'vitest'
import {
  defaultOrchestrator,
  laneAgentOnEnter,
  parseOrchestrator,
  planTick,
  leastLoaded,
  suggestOrchestrator,
  validateOrchestrator,
  type OrchestratorAgentInfo,
  type OrchestratorConfig,
  type PlanAgent,
  type PlanCard,
  type PlanInput
} from './orchestrator'

const STAGES = [
  { id: 'fila', name: 'Prioridades' },
  { id: 'dev', name: 'Em andamento' },
  { id: 'rev', name: 'Revisando' },
  { id: 'ok', name: 'Revisado' }
]

const CONFIG: OrchestratorConfig = {
  enabled: true,
  enabledSince: '2026-11-01T00:00:00.000Z',
  lanes: [
    { stageId: 'dev', agents: ['builtin:implementador', 'repo:ana'], next: 'rev' },
    { stageId: 'rev', agents: ['builtin:revisor'], next: 'ok' }
  ]
}

const READY: OrchestratorAgentInfo[] = [
  { key: 'builtin:implementador', name: 'Implementador', status: 'ready' },
  { key: 'repo:ana', name: 'Ana', status: 'ready' },
  { key: 'builtin:revisor', name: 'Revisor', status: 'ready' }
]

const BINDINGS = [
  { stageId: 'dev', flowId: 'f-dev', enabled: true, mode: 'on_enter' as const },
  { stageId: 'rev', flowId: 'f-rev', enabled: true, mode: 'on_enter' as const }
]

function agent(key: string, over: Partial<PlanAgent> = {}): PlanAgent {
  return { key, name: key, ready: true, capacity: 1, limitProblem: null, ...over }
}

function card(taskId: string, stageId: string | null, over: Partial<PlanCard> = {}): PlanCard {
  return {
    taskId,
    displayId: taskId.toUpperCase(),
    stageId,
    blocked: false,
    automationPaused: false,
    ...over
  }
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    config: CONFIG,
    cards: [],
    assignments: new Map(),
    agents: new Map(
      ['builtin:implementador', 'repo:ana', 'builtin:revisor'].map((k) => [k, agent(k)])
    ),
    load: new Map(),
    busy: new Set(),
    finishedHere: new Set(),
    carriedIn: new Set(),
    ...over
  }
}

describe('parseOrchestrator', () => {
  it('lê tolerante: descarta etapa repetida, agente inválido e campos antigos', () => {
    expect(
      parseOrchestrator({
        enabled: true,
        enabledSince: 'ontem',
        queueStageId: 'fila',
        maxActive: 50,
        lanes: [
          { stageId: 'dev', agents: ['repo:ana', 'repo:ana', 'x'], next: 'rev' },
          { stageId: 'dev', agents: [], next: null },
          'lixo'
        ]
      })
    ).toEqual({
      enabled: true,
      enabledSince: null,
      lanes: [{ stageId: 'dev', agents: ['repo:ana'], next: 'rev' }]
    })
    expect(parseOrchestrator('x')).toBeNull()
    expect(parseOrchestrator({})).toEqual(defaultOrchestrator())
  })
})

describe('suggestOrchestrator', () => {
  it('monta fila → implementação → revisão pelo papel das etapas, qualquer que seja o nome', () => {
    // Antes: regex nos nomes ("revisado|reviewed|…"); renomear desmontava a sugestão.
    const named = [
      { id: 'dev', name: 'Codando', role: 'work' as const },
      { id: 'fila', name: 'Backlog', role: 'queue' as const },
      { id: 'ok', name: 'Aprovado', role: 'reviewed' as const },
      { id: 'rev', name: 'Code review', role: 'review' as const }
    ]
    expect(suggestOrchestrator(named).lanes).toEqual([
      { stageId: 'dev', agents: ['builtin:implementador'], next: 'rev' },
      { stageId: 'rev', agents: ['builtin:revisor'], next: 'ok' }
    ])
  })

  it('sem papéis usa a ordem do quadro (desligado)', () => {
    expect(suggestOrchestrator(STAGES)).toEqual({
      ...defaultOrchestrator(),
      lanes: [
        { stageId: 'dev', agents: ['builtin:implementador'], next: 'rev' },
        { stageId: 'rev', agents: ['builtin:revisor'], next: 'ok' }
      ]
    })
  })

  it('sem nomes conhecidos usa a ordem; quadro curto não repete etapa', () => {
    const two = [
      { id: 'a', name: 'Um' },
      { id: 'b', name: 'Dois' }
    ]
    expect(suggestOrchestrator(two).lanes).toEqual([
      { stageId: 'b', agents: ['builtin:implementador'], next: null }
    ])
    expect(suggestOrchestrator([]).lanes).toEqual([])
  })
})

describe('validateOrchestrator', () => {
  it('config completa passa sem erros nem avisos', () => {
    expect(validateOrchestrator(CONFIG, STAGES, READY, BINDINGS)).toEqual({
      errors: [],
      warnings: []
    })
  })

  it('desligado aceita rascunho incompleto', () => {
    const draft = { ...defaultOrchestrator(), lanes: [{ stageId: 'x', agents: [], next: null }] }
    expect(validateOrchestrator(draft, STAGES, READY, BINDINGS).errors).toEqual([])
  })

  it('erros: etapa removida, sem agentes, agente inválido (a fila não é mais exigida)', () => {
    const { errors } = validateOrchestrator(
      {
        ...CONFIG,
        lanes: [
          { stageId: 'sumiu', agents: ['repo:ana'], next: null },
          { stageId: 'dev', agents: [], next: 'dev' },
          { stageId: 'rev', agents: ['repo:bob', 'repo:velho'], next: 'nada' }
        ]
      },
      STAGES,
      [...READY, { key: 'repo:velho', name: 'Velho', status: 'archived' }],
      BINDINGS
    )
    expect(errors).toEqual([
      'A etapa de trabalho 1 não existe mais no quadro.',
      'Escolha ao menos um agente para “Em andamento”.',
      'Depois de “Em andamento”: escolha outra etapa.',
      'Depois de “Revisando”: a etapa escolhida não existe mais.',
      'Um agente de “Revisando” não existe mais.',
      'Velho está arquivado.'
    ])
  })

  it('avisos: etapa sem fluxo ao entrar, perfil a revisar, agente sem permissão, ciclo', () => {
    const { errors, warnings } = validateOrchestrator(
      {
        ...CONFIG,
        lanes: [
          { stageId: 'dev', agents: ['repo:ana'], next: 'rev' },
          { stageId: 'rev', agents: ['builtin:revisor'], next: 'dev' }
        ]
      },
      STAGES,
      [
        { key: 'repo:ana', name: 'Ana', status: 'needs_review' },
        {
          key: 'builtin:revisor',
          name: 'Revisor',
          status: 'ready',
          deniedByStage: { rev: 'Revisor não pode entregar.' }
        }
      ],
      [BINDINGS[0]!, { ...BINDINGS[1]!, mode: 'manual' }]
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([
      'Ana precisa de revisão do perfil antes de pegar tarefas.',
      '“Revisando” não tem fluxo que roda ao entrar: os agentes não vão trabalhar nela. Ligue um fluxo em Etapas e automações.',
      'Revisor não pode entregar.',
      'As etapas de trabalho formam um ciclo a partir de “Em andamento”: a tarefa pode girar sem parar.'
    ])
  })
})

describe('leastLoaded (orquestrador e entrada na etapa)', () => {
  const agents = new Map([
    ['a', agent('a', { capacity: 2 })],
    ['b', agent('b', { capacity: 1 })],
    ['cheio', agent('cheio', { limitProblem: 'limite do dia' })],
    ['revisar', agent('revisar', { ready: false })]
  ])

  it('menor carga relativa; empate pela ordem; limite do dia só como último recurso', () => {
    expect(leastLoaded(['a', 'b'], agents, new Map([['a', 1]]))).toBe('b')
    expect(leastLoaded(['b', 'a'], agents, new Map([['b', 1]]))).toBe('a')
    expect(leastLoaded(['b', 'a'], agents, new Map())).toBe('b')
    expect(leastLoaded(['cheio', 'a'], agents, new Map([['a', 5]]))).toBe('a')
    expect(leastLoaded(['cheio'], agents, new Map())).toBe('cheio')
    expect(leastLoaded(['revisar'], agents, new Map())).toBeNull()
  })

  it('needFree: só quem tem vaga e sem limite; unknownCounts: desconhecido entra com carga 0', () => {
    expect(leastLoaded(['b', 'cheio'], agents, new Map([['b', 1]]), { needFree: true })).toBeNull()
    expect(leastLoaded(['nunca-visto'], agents, new Map())).toBeNull()
    expect(
      leastLoaded(['nunca-visto', 'a'], agents, new Map([['a', 1]]), { unknownCounts: true })
    ).toBe('nunca-visto')
  })
})

describe('planTick', () => {
  it('desligado ou sem etapas não decide nada', () => {
    expect(planTick(input({ config: { ...CONFIG, enabled: false } }))).toEqual([])
    expect(planTick(input({ config: { ...CONFIG, lanes: [] } }))).toEqual([])
  })

  it('nunca puxa da fila: quem começa uma tarefa é você', () => {
    const decisions = planTick(
      input({
        cards: [card('nova', 'fila'), card('urgente', 'fila')]
      })
    )
    expect(decisions).toEqual([])
  })

  it('não toca em tarefa bloqueada, pausada ou com fluxo ativo', () => {
    const decisions = planTick(
      input({
        cards: [
          card('b', 'dev', { blocked: true }),
          card('p', 'dev', { automationPaused: true }),
          card('f', 'dev')
        ],
        finishedHere: new Set(['b', 'p', 'f']),
        busy: new Set(['f'])
      })
    )
    expect(decisions).toEqual([])
  })

  it('fluxo concluído na etapa passa adiante: para outra etapa de agentes, com agente dela', () => {
    const decisions = planTick(
      input({
        cards: [card('t', 'dev'), card('u', 'rev')],
        finishedHere: new Set(['t', 'u']),
        assignments: new Map([['t', { key: 'builtin:implementador', manual: false }]]),
        // Passar adiante não espera vaga: o fluxo fica na fila do agente.
        load: new Map([['builtin:revisor', 3]])
      })
    )
    expect(decisions).toEqual([
      { kind: 'handoff', taskId: 't', from: 'dev', to: 'rev', agent: 'builtin:revisor' },
      { kind: 'handoff', taskId: 'u', from: 'rev', to: 'ok', agent: null }
    ])
  })

  it('sem próxima etapa a tarefa fica; sem agente pronto na próxima, espera', () => {
    const config: OrchestratorConfig = {
      ...CONFIG,
      lanes: [
        { stageId: 'dev', agents: ['repo:ana'], next: 'rev' },
        { stageId: 'rev', agents: ['repo:bob'], next: null }
      ]
    }
    const decisions = planTick(
      input({
        config,
        cards: [card('t', 'dev'), card('u', 'rev')],
        finishedHere: new Set(['t', 'u']),
        agents: new Map([
          ['repo:ana', agent('repo:ana')],
          ['repo:bob', agent('repo:bob', { ready: false })]
        ])
      })
    )
    expect(decisions).toEqual([
      { kind: 'wait', taskId: 't', reason: 'nenhum agente pronto na próxima etapa' }
    ])
  })

  it('tarefa que entrou na etapa durante a entrega roda o fluxo dela com um agente da etapa', () => {
    const decisions = planTick(
      input({
        cards: [card('t', 'rev')],
        carriedIn: new Set(['t']),
        assignments: new Map([['t', { key: 'builtin:implementador', manual: false }]])
      })
    )
    expect(decisions).toEqual([
      { kind: 'start', taskId: 't', stageId: 'rev', agent: 'builtin:revisor' }
    ])
  })
})

describe('laneAgentOnEnter', () => {
  const agents = new Map([
    ['builtin:implementador', agent('builtin:implementador', { capacity: 2 })],
    ['repo:ana', agent('repo:ana')]
  ])

  it('dá o menos ocupado da etapa; mantém quem já é da etapa ou foi escolhido à mão', () => {
    const load = new Map([['builtin:implementador', 1]])
    expect(laneAgentOnEnter(CONFIG, 'dev', null, agents, load)).toBe('repo:ana')
    expect(
      laneAgentOnEnter(CONFIG, 'dev', { key: 'builtin:revisor', manual: false }, agents, load)
    ).toBe('repo:ana')
    expect(
      laneAgentOnEnter(CONFIG, 'dev', { key: 'builtin:implementador', manual: false }, agents, load)
    ).toBeNull()
    expect(
      laneAgentOnEnter(CONFIG, 'dev', { key: 'repo:bob', manual: true }, agents, load)
    ).toBeNull()
  })

  it('fora das etapas de trabalho ou desligado não mexe', () => {
    expect(laneAgentOnEnter(CONFIG, 'fila', null, agents, new Map())).toBeNull()
    expect(
      laneAgentOnEnter({ ...CONFIG, enabled: false }, 'dev', null, agents, new Map())
    ).toBeNull()
  })
})

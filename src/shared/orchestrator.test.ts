import { describe, expect, it } from 'vitest'
import {
  defaultOrchestrator,
  laneAgentOnEnter,
  parseOrchestrator,
  planTick,
  priorityRank,
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
  queueStageId: 'fila',
  maxActive: 2,
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
    priority: null,
    blocked: false,
    automationPaused: false,
    index: 0,
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
    activeTotal: 0,
    busy: new Set(),
    finishedHere: new Set(),
    carriedIn: new Set(),
    ...over
  }
}

describe('parseOrchestrator', () => {
  it('lê tolerante: descarta etapa repetida, agente inválido e limita o teto', () => {
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
      queueStageId: 'fila',
      maxActive: 10,
      lanes: [{ stageId: 'dev', agents: ['repo:ana'], next: 'rev' }]
    })
    expect(parseOrchestrator('x')).toBeNull()
    expect(parseOrchestrator({})).toEqual(defaultOrchestrator())
  })
})

describe('suggestOrchestrator', () => {
  it('monta fila → implementação → revisão pelo nome das etapas (desligado)', () => {
    expect(suggestOrchestrator(STAGES)).toEqual({
      ...defaultOrchestrator(),
      queueStageId: 'fila',
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

  it('erros: sem fila, etapa removida, fila como trabalho, sem agentes, agente inválido', () => {
    const { errors } = validateOrchestrator(
      {
        ...CONFIG,
        queueStageId: null,
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
      'Escolha a coluna de fila (de onde puxar tarefas).',
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

describe('priorityRank', () => {
  it('ordena nomes usuais pt/en, P0…P9 e números; sem prioridade por último', () => {
    const names = ['Baixa', null, 'P1', 'Urgente', 'Média', 'Alta', 'Coisa', '0']
    expect([...names].sort((a, b) => priorityRank(a) - priorityRank(b))).toEqual([
      'Urgente',
      '0',
      'P1',
      'Alta',
      'Média',
      'Baixa',
      'Coisa',
      null
    ])
  })
})

describe('planTick', () => {
  it('desligado ou sem etapas não decide nada', () => {
    expect(planTick(input({ config: { ...CONFIG, enabled: false } }))).toEqual([])
    expect(planTick(input({ config: { ...CONFIG, lanes: [] } }))).toEqual([])
  })

  it('puxa da fila por prioridade e depois a mais antiga, até o teto, dividindo entre agentes', () => {
    const decisions = planTick(
      input({
        cards: [
          card('nova', 'fila', { index: 0 }),
          card('antiga', 'fila', { index: 5 }),
          card('urgente', 'fila', { index: 1, priority: 'Urgente' })
        ]
      })
    )
    expect(decisions).toEqual([
      { kind: 'pull', taskId: 'urgente', from: 'fila', to: 'dev', agent: 'builtin:implementador' },
      { kind: 'pull', taskId: 'antiga', from: 'fila', to: 'dev', agent: 'repo:ana' },
      { kind: 'wait', taskId: 'nova', reason: 'teto de tarefas ao mesmo tempo' }
    ])
  })

  it('respeita a capacidade e o limite do dia de cada agente', () => {
    const decisions = planTick(
      input({
        config: { ...CONFIG, maxActive: 5 },
        cards: [card('a', 'fila'), card('b', 'fila')],
        load: new Map([['builtin:implementador', 1]]),
        agents: new Map([
          ['builtin:implementador', agent('builtin:implementador')],
          ['repo:ana', agent('repo:ana', { limitProblem: 'Ana atingiu o limite de hoje.' })]
        ])
      })
    )
    expect(decisions).toEqual([
      { kind: 'wait', taskId: 'a', reason: 'nenhum agente livre' },
      { kind: 'wait', taskId: 'b', reason: 'nenhum agente livre' }
    ])
  })

  it('o teto conta o que já está em andamento no projeto', () => {
    const decisions = planTick(input({ cards: [card('a', 'fila')], activeTotal: 2 }))
    expect(decisions).toEqual([
      { kind: 'wait', taskId: 'a', reason: 'teto de tarefas ao mesmo tempo' }
    ])
  })

  it('não toca em tarefa bloqueada, pausada ou com fluxo ativo', () => {
    const decisions = planTick(
      input({
        cards: [
          card('b', 'fila', { blocked: true }),
          card('p', 'fila', { automationPaused: true }),
          card('f', 'fila')
        ],
        busy: new Set(['f'])
      })
    )
    expect(decisions).toEqual([])
  })

  it('atribuição à mão a alguém de fora da etapa é respeitada (espera esse agente)', () => {
    const assignments = new Map([['a', { key: 'repo:bob', manual: true }]])
    const agents = new Map([
      ['builtin:implementador', agent('builtin:implementador')],
      ['repo:bob', agent('repo:bob')]
    ])
    expect(planTick(input({ cards: [card('a', 'fila')], assignments, agents }))).toEqual([
      { kind: 'pull', taskId: 'a', from: 'fila', to: 'dev', agent: 'repo:bob' }
    ])
    const busy = new Map([['repo:bob', 1]])
    expect(
      planTick(input({ cards: [card('a', 'fila')], assignments, agents, load: busy }))
    ).toEqual([{ kind: 'wait', taskId: 'a', reason: 'nenhum agente livre' }])
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrchestratorConfig } from '../../shared/orchestrator'
import { AgentsService } from '../agents/agents.service'
import type { StageChange } from '../board/board.service'
import { BoardStore } from '../board/board.store'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import { openDatabase, type Db } from '../db/database'
import type { ConfigStore } from '../storage/config-store'
import { OrchestratorService } from './orchestrator.service'
import type { BoardCard, BoardView } from '../../shared/board'
import type { Result } from '../../shared/result'
import { isLive } from '../../shared/flow-run-state'
import type { FlowRunStatus } from '../../shared/task-flow'
import type { LastFlow } from '../flows/flow-runner'

const P = 'p1'
const STAGES = ['fila', 'dev', 'rev', 'ok']
const ENABLED: OrchestratorConfig = {
  enabled: true,
  enabledSince: null,
  lanes: [
    { stageId: 'dev', agents: ['builtin:implementador'], next: 'rev' },
    { stageId: 'rev', agents: ['builtin:revisor'], next: 'ok' }
  ]
}

let dir: string
let db: Db
let store: BoardStore
let config: ConfigStore<OrkioConfig>
let agents: AgentsService
let service: OrchestratorService
let cards: BoardCard[]
let started: string[]
let active: Set<string>
let clock: number
let pending: (() => void)[]

const at = (min: number): string => new Date(Date.UTC(2026, 10, 20, 12, min)).toISOString()

function makeCard(taskId: string, stageId: string, over: Partial<BoardCard> = {}): BoardCard {
  return {
    taskId,
    displayId: taskId.toUpperCase(),
    title: taskId,
    url: null,
    status: null,
    priority: null,
    assignees: [],
    stageId,
    blocked: false,
    automationPaused: false,
    sync: { state: 'synced' },
    ...over
  }
}

/** Entra na etapa (estado local + evento), como o BoardService faria. */
function place(taskId: string, stageId: string, when: string): void {
  store.upsertState({
    taskPageId: taskId,
    projectId: P,
    stageId,
    blocked: false,
    updatedAt: when,
    source: 'manual'
  })
  store.addEvent({
    taskPageId: taskId,
    projectId: P,
    at: when,
    kind: 'moved',
    source: 'manual',
    fromStage: null,
    toStage: stageId,
    detail: {}
  })
  const card = cards.find((c) => c.taskId === taskId)
  if (card) card.stageId = stageId
  else cards.push(makeCard(taskId, stageId))
}

/** Execuções de fluxo que o executor (fake) responde ao orquestrador. */
interface FakeRun extends LastFlow {
  taskId: string
  agentKey: string | null
}
let runs: FakeRun[]

function flowRun(
  taskId: string,
  stageId: string | null,
  startedAt: string,
  endedAt: string | null,
  over: { status?: FlowRunStatus; result?: LastFlow['result']; agent?: string | null } = {}
): void {
  runs.push({
    taskId,
    stageId,
    status: over.status ?? 'finished',
    result: over.result === undefined ? 'done' : over.result,
    startedAt,
    endedAt,
    agentKey: over.agent ?? null
  })
}

const fakeFlows = {
  activeCountByAgent: (): Map<string, number> => {
    const out = new Map<string, number>()
    for (const r of runs) {
      if (r.agentKey && isLive(r.status)) out.set(r.agentKey, (out.get(r.agentKey) ?? 0) + 1)
    }
    return out
  },
  activeTasks: () =>
    runs.filter((r) => isLive(r.status)).map((r) => ({ taskId: r.taskId, agentKey: r.agentKey })),
  lastFlow: (taskId: string): LastFlow | null =>
    runs
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] ?? null
}

async function enable(over: Partial<OrchestratorConfig> = {}): Promise<void> {
  await config.update((c) => ({
    ...c,
    orchestrator: { [P]: { ...ENABLED, enabledSince: at(0), ...over } }
  }))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-orch-'))
  const projectDir = join(dir, 'projeto')
  await mkdir(projectDir, { recursive: true })
  config = createOrkioConfigStore(join(dir, 'orkio-config.json'))
  await config.load()
  await config.update((c) => ({
    ...c,
    projects: [
      {
        id: P,
        name: 'Projeto',
        localPath: projectDir,
        repo: null,
        createdAt: 'x',
        updatedAt: 'x',
        notionProject: { id: 'np', name: 'NP' }
      }
    ],
    boards: {
      [P]: {
        stages: STAGES.map((id, order) => ({
          id,
          name: id,
          order,
          notionStatus: { id: null, name: id },
          color: 'gray'
        })),
        orkioStageProperty: null,
        blockedProperty: null,
        rules: [],
        updatedAt: 'x'
      }
    },
    flows: {
      [P]: {
        flows: [],
        bindings: [
          { stageId: 'dev', flowId: 'f-dev', enabled: true, mode: 'on_enter' },
          { stageId: 'rev', flowId: 'f-rev', enabled: true, mode: 'on_enter' }
        ]
      }
    }
  }))
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  cards = []
  started = []
  active = new Set()
  runs = []
  pending = []
  clock = Date.parse(at(30))
  agents = new AgentsService({
    db,
    store,
    config,
    localDir: join(dir, 'agents'),
    hasActiveFlow: (t) => active.has(t),
    agentRuns: () => ({ count: 0, costUsd: 0, startedAt: [] }),
    stageIds: () => STAGES,
    actor: () => 'bruno',
    emit: () => undefined,
    now: () => new Date(clock)
  })
  service = new OrchestratorService({
    config,
    store,
    board: {
      get: async () =>
        ({
          ok: true,
          value: { cards, config: {} } as unknown as BoardView
        }) as Result<BoardView>,
      applyAutomationMove: (_tx, projectId, taskId, stageId, event) => {
        const from = cards.find((c) => c.taskId === taskId)?.stageId ?? null
        if (from === stageId) return false
        place(taskId, stageId, new Date(clock).toISOString())
        store.addEvent({
          taskPageId: taskId,
          projectId,
          at: new Date(clock).toISOString(),
          kind: 'moved',
          source: 'automation',
          fromStage: from,
          toStage: stageId,
          detail: event.detail,
          eventKey: event.key
        })
        const change: StageChange = { projectId, taskId, from, to: stageId, source: 'automation' }
        service.onStageChanged(change)
        return true
      },
      flushWrites: () => undefined
    },
    agents,
    flows: {
      ...fakeFlows,
      hasActive: (t) => active.has(t),
      startManual: async (_p, t) => {
        started.push(`${t}:${agents.assignedKey(t)}`)
      }
    },
    actor: () => 'bruno',
    emit: () => undefined,
    now: () => new Date(clock),
    schedule: (fn) => void pending.push(fn)
  })
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('fila', () => {
  it('nunca puxa da fila: a tarefa só começa quando você move', async () => {
    await enable()
    place('a', 'fila', at(1))
    place('b', 'fila', at(2))
    await service.tick(P)
    expect(cards.map((c) => [c.taskId, c.stageId])).toEqual([
      ['a', 'fila'],
      ['b', 'fila']
    ])
    expect(agents.assignment('a')).toBeNull()
  })
})

describe('passar adiante', () => {
  it('fluxo concluído na etapa leva a tarefa para a próxima, com o agente dela', async () => {
    await enable()
    place('t', 'dev', at(5))
    store.transaction(() => agents.assignByOrchestrator(P, 't', 'builtin:implementador', 'I'))
    flowRun('t', 'dev', at(6), at(20), { agent: 'builtin:implementador' })
    await service.tick(P)
    expect(cards[0]?.stageId).toBe('rev')
    expect(agents.assignment('t')?.key).toBe('builtin:revisor')
  })

  it('não segue com fluxo recusado/cancelado, ativo ou terminado antes de ligar', async () => {
    await enable({ enabledSince: at(10) })
    place('rej', 'dev', at(1))
    flowRun('rej', 'dev', at(11), at(12), { result: 'rejected' })
    place('ativo', 'dev', at(1))
    flowRun('ativo', 'dev', at(11), null, { status: 'waiting_gate', result: null })
    place('velho', 'dev', at(1))
    flowRun('velho', 'dev', at(2), at(5))
    await service.tick(P)
    expect(cards.map((c) => c.stageId)).toEqual(['dev', 'dev', 'dev'])
  })

  it('fluxo anterior à entrada na etapa não conta (voltou para a etapa depois)', async () => {
    await enable()
    flowRun('t', 'dev', at(2), at(4))
    place('t', 'dev', at(5))
    await service.tick(P)
    expect(cards[0]?.stageId).toBe('dev')
  })

  it('entrou na etapa durante a entrega: roda o fluxo da etapa com um agente dela', async () => {
    await enable()
    store.transaction(() => agents.assignByOrchestrator(P, 't', 'builtin:implementador', 'I'))
    flowRun('t', null, at(2), at(8))
    place('t', 'rev', at(6))
    await service.tick(P)
    expect(started).toEqual(['t:builtin:revisor'])
    expect(cards[0]?.stageId).toBe('rev')
  })
})

describe('entrada por outro caminho', () => {
  it('você move para uma etapa de trabalho: ganha um agente dela (menos a escolha à mão)', async () => {
    await enable()
    await service.tick(P) // carrega os agentes
    service.onStageChanged({ projectId: P, taskId: 'x', from: 'fila', to: 'rev', source: 'manual' })
    expect(agents.assignment('x')?.key).toBe('builtin:revisor')

    await agents.assign(P, 'y', 'builtin:qa')
    service.onStageChanged({ projectId: P, taskId: 'y', from: 'fila', to: 'rev', source: 'manual' })
    expect(agents.assignment('y')?.key).toBe('builtin:qa')

    service.onStageChanged({ projectId: P, taskId: 'z', from: 'dev', to: 'rev', source: 'notion' })
    expect(agents.assignment('z')).toBeNull()
  })

  it('etapa sem raia (ex.: Revisado): o agente do orquestrador sai; o escolhido à mão fica', async () => {
    await enable()
    // Caso real: Revisando → Revisado com o Revisor (que não entrega) travava o fluxo da coluna.
    place('t', 'rev', at(5))
    store.transaction(() => agents.assignByOrchestrator(P, 't', 'builtin:revisor', 'Revisor'))
    flowRun('t', 'rev', at(6), at(20), { agent: 'builtin:revisor' })
    await service.tick(P)
    expect(cards[0]?.stageId).toBe('ok')
    expect(agents.assignment('t')).toBeNull()
    expect(store.events('t').find((e) => e.kind === 'agent_unassigned')).toMatchObject({
      detail: { agentKey: 'builtin:revisor', agent: 'Revisor', by: 'orchestrator' }
    })

    await agents.assign(P, 'm', 'builtin:revisor')
    service.onStageChanged({ projectId: P, taskId: 'm', from: 'rev', to: 'ok', source: 'manual' })
    expect(agents.assignment('m')?.key).toBe('builtin:revisor')

    // Agente que não é de nenhuma raia (regra de coluna da 8A) também fica.
    store.transaction(() => agents.assignByOrchestrator(P, 'q', 'builtin:qa', 'QA'))
    service.onStageChanged({
      projectId: P,
      taskId: 'q',
      from: 'rev',
      to: 'ok',
      source: 'automation'
    })
    expect(agents.assignment('q')?.key).toBe('builtin:qa')
  })

  it('antes da primeira rodada, o histórico mostra o nome do agente embutido (não o id)', async () => {
    await enable()
    service.onStageChanged({ projectId: P, taskId: 'w', from: 'fila', to: 'rev', source: 'manual' })
    expect(agents.assignment('w')?.key).toBe('builtin:revisor')
    expect(store.events('w')[0]?.detail).toMatchObject({ agent: 'Revisor', by: 'orchestrator' })
  })
})

describe('salvar', () => {
  it('valida no main, registra quando ligou e o histórico de configuração', async () => {
    await expect(service.save(P, { ...ENABLED, lanes: [] })).rejects.toMatchObject({
      code: 'invalid'
    })
    const state = await service.save(P, ENABLED)
    expect(state.config.enabledSince).toBe(new Date(clock).toISOString())
    expect(state.validation).toEqual({ errors: [], warnings: [] })
    expect(store.configEvents(P)[0]?.changes).toEqual([
      'Orquestrador ligado',
      'Orquestrador: dev (1 agente) → rev (1 agente)'
    ])
    expect(pending).toHaveLength(1)

    // Salvar de novo (ligado) mantém a data; desligar limpa.
    clock += 60_000
    expect(
      (await service.save(P, { ...ENABLED, lanes: [...ENABLED.lanes].reverse() })).config
        .enabledSince
    ).toBe(state.config.enabledSince)
    expect((await service.save(P, { ...ENABLED, enabled: false })).config.enabledSince).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BoardCard, BoardView, NotionResult } from '../../shared/ipc-contract'
import type { OrchestratorConfig } from '../../shared/orchestrator'
import { AgentsService } from '../agents/agents.service'
import type { StageChange } from '../board/board.service'
import { BoardStore } from '../board/board.store'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import { openDatabase, type Db } from '../db/database'
import type { ConfigStore } from '../storage/config-store'
import { OrchestratorService } from './orchestrator.service'

const P = 'p1'
const STAGES = ['fila', 'dev', 'rev', 'ok']
const ENABLED: OrchestratorConfig = {
  enabled: true,
  enabledSince: null,
  queueStageId: 'fila',
  maxActive: 2,
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
    detail: null
  })
  const card = cards.find((c) => c.taskId === taskId)
  if (card) card.stageId = stageId
  else cards.push(makeCard(taskId, stageId))
}

function flowRun(
  taskId: string,
  stageId: string | null,
  startedAt: string,
  endedAt: string | null,
  over: { status?: string; result?: string | null; agent?: string | null } = {}
): void {
  db.run(
    `INSERT INTO flow_runs (id, task_page_id, project_id, flow_id, flow_json, stage_id, status, state_json, started_at, ended_at, result, agent_key)
     VALUES (?, ?, ?, 'f', '{}', ?, ?, '{}', ?, ?, ?, ?)`,
    `${taskId}-${startedAt}`,
    taskId,
    P,
    stageId,
    over.status ?? 'finished',
    startedAt,
    endedAt,
    over.result === undefined ? 'done' : over.result,
    over.agent ?? null
  )
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
  pending = []
  clock = Date.parse(at(30))
  agents = new AgentsService({
    db,
    store,
    config,
    localDir: join(dir, 'agents'),
    hasActiveFlow: (t) => active.has(t),
    stageIds: () => STAGES,
    actor: () => 'bruno',
    emit: () => undefined,
    now: () => new Date(clock)
  })
  service = new OrchestratorService({
    config,
    db,
    store,
    board: {
      get: async () =>
        ({
          ok: true,
          value: { cards, config: {} } as unknown as BoardView
        }) as NotionResult<BoardView>,
      applyAutomationMove: (projectId, taskId, stageId, event) => {
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

describe('puxar da fila', () => {
  it('atribui e move para a primeira etapa, respeitando a capacidade do agente', async () => {
    await enable()
    place('a', 'fila', at(1))
    place('b', 'fila', at(2))
    await service.tick(P)
    // Implementador: 2 em paralelo; as duas vão (o teto do projeto também é 2).
    expect(cards.map((c) => [c.taskId, c.stageId])).toEqual([
      ['a', 'dev'],
      ['b', 'dev']
    ])
    expect(agents.assignment('a')).toEqual({ key: 'builtin:implementador', manual: false })
    const moved = store.events('a').find((e) => e.kind === 'moved' && e.source === 'automation')
    expect(moved?.detail).toMatchObject({ orchestrator: 'pull', agent: 'Implementador' })

    // Uma terceira não passa do teto, nem enquanto o fluxo das outras ainda não apareceu.
    place('c', 'fila', at(3))
    await service.tick(P)
    expect(cards.find((c) => c.taskId === 'c')?.stageId).toBe('fila')
    const state = await service.state(P)
    expect(state.status.waiting).toEqual([
      { taskId: 'c', displayId: 'C', reason: 'teto de tarefas ao mesmo tempo' }
    ])
    expect(state.agents.find((a) => a.key === 'builtin:implementador')?.active).toBe(2)
  })

  it('desligado não faz nada', async () => {
    place('a', 'fila', at(1))
    await service.tick(P)
    expect(cards[0]?.stageId).toBe('fila')
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
})

describe('salvar', () => {
  it('valida no main, registra quando ligou e o histórico de configuração', async () => {
    await expect(service.save(P, { ...ENABLED, queueStageId: null })).rejects.toMatchObject({
      code: 'invalid'
    })
    const state = await service.save(P, ENABLED)
    expect(state.config.enabledSince).toBe(new Date(clock).toISOString())
    expect(state.validation).toEqual({ errors: [], warnings: [] })
    expect(store.configEvents(P)[0]?.changes).toEqual([
      'Orquestrador ligado',
      'Orquestrador: fila fila, até 2 ao mesmo tempo, dev (1 agente) → rev (1 agente)'
    ])
    expect(pending).toHaveLength(1)

    // Salvar de novo (ligado) mantém a data; desligar limpa.
    clock += 60_000
    expect((await service.save(P, { ...ENABLED, maxActive: 3 })).config.enabledSince).toBe(
      state.config.enabledSince
    )
    expect((await service.save(P, { ...ENABLED, enabled: false })).config.enabledSince).toBeNull()
  })
})

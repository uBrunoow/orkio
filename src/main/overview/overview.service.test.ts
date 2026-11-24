import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowRunView } from '../../shared/task-flow'
import type { TaskSignals } from '../../shared/task-signals'
import { BoardStore } from '../board/board.store'
import { emptyConfig, type OrkioConfig } from '../config/orkio-config'
import { openDatabase, type Db } from '../db/database'
import { applyWaitingBadge, overlayDotBitmap, waitingDescription } from './badge'
import { OverviewService, type OverviewDeps } from './overview.service'
import { parseActivityQuery } from '../ipc/overview.ipc'
import type { NotionTask } from '../../shared/notion'
import type { ProjectView } from '../../shared/projects'

const NOW = new Date('2026-11-20T12:00:00.000Z')

let db: Db
let store: BoardStore
let config: OrkioConfig
let flows: FlowRunView[]
let requests: ReturnType<OverviewDeps['requests']>
let runs: ReturnType<OverviewDeps['runs']>
let tasks: Record<string, NotionTask[] | null>
let signals: Record<string, Record<string, TaskSignals> | null>
let changed: number[]
let refreshed: string[]

function project(id: string, name: string): ProjectView {
  return {
    id,
    name,
    localPath: `/tmp/${id}`,
    repo: null,
    createdAt: 'x',
    updatedAt: 'x',
    local: null,
    health: { state: 'ok' },
    notices: [],
    notionProject: { id: `n-${id}`, name }
  }
}

function service(over: Partial<OverviewDeps> = {}): OverviewService {
  return new OverviewService({
    db,
    config: () => config,
    projects: async () => config.projects.map((p) => project(p.id, p.name)),
    flows: () => flows,
    requests: () => requests,
    runs: () => runs,
    cachedTasks: (projectId) => tasks[projectId] ?? null,
    notionHealth: () => 'ok',
    signals: (projectId) => signals[projectId] ?? null,
    pulls: () => null,
    refresh: async (projectId) => {
      refreshed.push(projectId)
    },
    changed: (n) => changed.push(n),
    now: () => NOW,
    debounceMs: 10,
    ...over
  })
}

function gateFlow(over: Partial<FlowRunView> = {}): FlowRunView {
  return {
    id: 'fr1',
    projectId: 'p1',
    taskId: 't1',
    flowId: 'f',
    flowName: 'Revisar',
    agent: null,
    revise: null,
    steps: [
      {
        id: 'ok',
        name: 'Aprovar',
        type: 'gate',
        message: '?',
        show: 'none',
        onReject: 'stop',
        timeoutMin: null
      }
    ],
    status: 'waiting_gate',
    currentStep: 'ok',
    pauseReason: null,
    result: null,
    startedAt: '2026-11-20T11:00:00.000Z',
    endedAt: null,
    vars: {},
    history: [],
    choice: null,
    confirm: null,
    ...over
  }
}

function event(e: {
  task: string
  project?: string
  at: string
  kind: Parameters<BoardStore['addEvent']>[0]['kind']
  source?: 'manual' | 'notion' | 'automation'
  from?: string | null
  to?: string | null
  detail?: Record<string, unknown> | null
}): void {
  store.addEvent({
    taskPageId: e.task,
    projectId: e.project ?? 'p1',
    at: e.at,
    kind: e.kind,
    source: e.source ?? 'manual',
    fromStage: e.from ?? null,
    toStage: e.to ?? null,
    detail: e.detail ?? null
  })
}

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new BoardStore(db)
  config = {
    ...emptyConfig(),
    projects: [
      {
        id: 'p1',
        name: 'Orkio',
        localPath: '/tmp/p1',
        repo: null,
        createdAt: 'x',
        updatedAt: 'x',
        notionProject: { id: 'n1', name: 'Orkio' }
      },
      {
        id: 'p2',
        name: 'API',
        localPath: '/tmp/p2',
        repo: null,
        createdAt: 'x',
        updatedAt: 'x',
        notionProject: null
      }
    ],
    boards: {
      p1: {
        stages: [
          { id: 's1', name: 'Prioridades', order: 0, notionStatus: { id: 'a', name: 'A' } },
          { id: 's2', name: 'Revisado', order: 1, notionStatus: { id: 'a', name: 'A' } },
          { id: 's3', name: 'Finalizada', order: 2, notionStatus: { id: 'b', name: 'B' } }
        ],
        orkioStageProperty: null,
        blockedProperty: null,
        rules: [],
        updatedAt: 'x'
      }
    }
  }
  flows = []
  requests = []
  runs = []
  tasks = {
    p1: [
      {
        id: 't1',
        url: null,
        displayId: 'ORK-1',
        title: 'Exportar CSV',
        status: null,
        priority: null,
        assignees: []
      }
    ]
  }
  signals = {}
  changed = []
  refreshed = []
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
})

describe('OverviewService', () => {
  it('"Esperando você" junta gates, perguntas e escritas recusadas, com ID e título do cache', async () => {
    flows = [gateFlow()]
    requests = [
      {
        runId: 'r1',
        projectId: 'p1',
        taskId: 't2',
        requestId: 'q',
        kind: 'question',
        summary: 'Qual?',
        since: '2026-11-20T11:30:00.000Z'
      }
    ]
    event({
      task: 't3',
      at: '2026-11-20T10:00:00.000Z',
      kind: 'rolled_back',
      to: 's1',
      detail: { code: 'forbidden' }
    })
    // Recusa antiga (fora das 24 h) e recusa já resolvida por um movimento depois: não aparecem.
    event({ task: 't4', at: '2026-11-18T10:00:00.000Z', kind: 'rolled_back' })
    event({ task: 't5', at: '2026-11-20T09:00:00.000Z', kind: 'rolled_back' })
    event({ task: 't5', at: '2026-11-20T09:05:00.000Z', kind: 'moved', from: 's1', to: 's2' })
    // Projeto removido: fora.
    event({ task: 't6', project: 'gone', at: '2026-11-20T10:00:00.000Z', kind: 'rolled_back' })

    const snap = await service().snapshot()
    expect(snap.waiting.map((w) => [w.kind, w.task.taskId])).toEqual([
      ['notion_write', 't3'],
      ['gate', 't1'],
      ['question', 't2']
    ])
    expect(snap.waiting[1]?.task).toMatchObject({
      displayId: 'ORK-1',
      title: 'Exportar CSV',
      projectName: 'Orkio'
    })
    expect(snap.waiting[2]?.task).toMatchObject({ displayId: null, title: null })
    expect(snap.projects.find((p) => p.projectId === 'p1')?.waiting).toBe(3)
  })

  it('escrita presa tentando de novo entra a partir da 3ª tentativa', () => {
    db.run(
      `INSERT INTO pending_writes (task_page_id, project_id, payload_json, rollback_json, attempts, next_attempt_at, last_error_code, created_at)
       VALUES ('t1', 'p1', '{}', '{"stageId":null,"blocked":false}', 3, 'x', 'network', '2026-11-20T08:00:00.000Z'),
              ('t2', 'p1', '{}', '{"stageId":null,"blocked":false}', 1, 'x', 'network', '2026-11-20T08:00:00.000Z')`
    )
    expect(
      service()
        .waiting()
        .map((w) => w.key)
    ).toEqual(['notion:pending:1'])
  })

  it('sem cache do Notion, o ID vem da branch do worktree e o título fica vazio', () => {
    tasks = {}
    db.run(
      `INSERT INTO worktrees (task_page_id, project_id, path, branch, base_ref, created_at) VALUES ('t1', 'p1', '/w', 'ork-1/exportar-csv', 'origin/main', 'x')`
    )
    flows = [gateFlow()]
    expect(service().waiting()[0]?.task).toMatchObject({ displayId: 'ORK-1', title: null })
  })

  it('lembra o título visto mesmo depois de o cache ser invalidado', () => {
    flows = [gateFlow()]
    const s = service()
    s.waiting()
    tasks = {}
    expect(s.waiting()[0]?.task.title).toBe('Exportar CSV')
  })

  it('"Em execução" lê início e comando do SQLite', async () => {
    db.run(
      `INSERT INTO agent_runs (id, task_page_id, project_id, mode, command, status, started_at) VALUES ('r1', 't1', 'p1', 'command', 'revisar', 'running', '2026-11-20T11:50:00.000Z')`
    )
    runs = [{ runId: 'r1', projectId: 'p1', taskId: 't1', status: 'running' }]
    const snap = await service().snapshot()
    expect(snap.running).toEqual([
      expect.objectContaining({
        key: 'run:r1',
        label: 'Claude Code · /revisar',
        startedAt: '2026-11-20T11:50:00.000Z',
        section: 'claude'
      })
    ])
  })

  it('PRs e aviso quando o GitHub ainda não foi lido', async () => {
    config = {
      ...config,
      projects: config.projects.map((p) => ({ ...p, repo: { owner: 'o', name: 'r' } as never }))
    }
    signals = {
      p1: {
        t1: {
          taskId: 't1',
          displayId: 'ORK-1',
          localBranches: [],
          remoteBranches: [],
          otherPrs: 0,
          pr: {
            number: 9,
            title: 'x',
            url: 'https://github.com/o/r/pull/9',
            state: 'open',
            merged: false,
            headRef: 'ORK-1/x',
            updatedAt: 'x',
            reviewDecision: 'changes_requested',
            unresolvedComments: 0,
            checks: 'success'
          }
        }
      }
    }
    const snap = await service().snapshot()
    expect(snap.prs.map((p) => [p.number, p.reasons, p.task.displayId])).toEqual([
      [9, ['changes_requested'], 'ORK-1']
    ])
    // p2 não tem vínculo com o Notion: sem aviso por ele; p1 tem sinais.
    expect(snap.notices).toEqual([])
    signals = {}
    expect((await service().snapshot()).notices).toHaveLength(1)
  })

  it('por projeto e semana: contagem por etapa, finalizadas, Revisado e custo', async () => {
    store.upsertState({
      taskPageId: 't1',
      projectId: 'p1',
      stageId: 's3',
      blocked: false,
      updatedAt: 'x',
      source: 'manual'
    })
    store.upsertState({
      taskPageId: 't2',
      projectId: 'p1',
      stageId: 's1',
      blocked: true,
      updatedAt: 'x',
      source: 'manual'
    })
    event({ task: 't1', at: '2026-11-15T00:00:00.000Z', kind: 'moved', from: 's1', to: 's2' })
    event({ task: 't1', at: '2026-11-17T00:00:00.000Z', kind: 'moved', from: 's2', to: 's3' })
    db.run(
      `INSERT INTO agent_runs (id, task_page_id, project_id, mode, command, status, started_at, cost) VALUES
       ('a', 't1', 'p1', 'prompt', NULL, 'succeeded', '2026-11-19T00:00:00.000Z', 0.4),
       ('b', 't1', 'p1', 'prompt', NULL, 'failed', '2026-11-19T00:00:00.000Z', NULL),
       ('c', 't1', 'p1', 'prompt', NULL, 'succeeded', '2026-11-01T00:00:00.000Z', 9)`
    )
    const snap = await service().snapshot()
    const p1 = snap.projects.find((p) => p.projectId === 'p1')!
    expect(p1.stages.map((s) => s.count)).toEqual([1, 0, 1])
    expect(p1.blocked).toBe(1)
    expect(snap.projects.find((p) => p.projectId === 'p2')?.hasBoard).toBe(false)
    expect(snap.week).toMatchObject({
      finished: 1,
      reviewSamples: 1,
      reviewAvgMs: 2 * 24 * 60 * 60 * 1000,
      cost: { usd: 0.4, known: 1, total: 2 },
      prsOpened: null
    })
  })

  it('atividade: mais recente primeiro, filtro por projeto e tipo, paginação', () => {
    for (let i = 0; i < 5; i++) {
      event({ task: 't1', at: `2026-11-20T0${i}:00:00.000Z`, kind: 'moved', from: 's1', to: 's2' })
    }
    event({
      task: 't1',
      at: '2026-11-20T06:00:00.000Z',
      kind: 'moved',
      source: 'automation',
      from: 's2',
      to: 's3',
      detail: { event: 'pr.merged', pr: { number: 4, owner: 'o', repo: 'r' }, ruleName: 'Merge' }
    })
    event({
      task: 't1',
      at: '2026-11-20T07:00:00.000Z',
      kind: 'automation',
      source: 'automation',
      detail: { outcome: 'noop' }
    })
    event({ task: 't1', at: '2026-11-20T07:30:00.000Z', kind: 'sync_ok' })
    event({ task: 't9', project: 'p2', at: '2026-11-20T08:00:00.000Z', kind: 'run_started' })
    event({ task: 't1', at: '2026-11-01T00:00:00.000Z', kind: 'moved', from: 's1', to: 's2' })

    const s = service()
    const all = s.activity({ limit: 3 })
    expect(all.items.map((i) => i.group)).toEqual(['claude', 'automation', 'board'])
    expect(all.items[1]?.link).toBe('https://github.com/o/r/pull/4')
    expect(all.items[2]?.text).toBe('Movida de Prioridades para Revisado')
    expect(all.hasMore).toBe(true)
    const next = s.activity({ limit: 3, beforeId: all.items[2]!.id })
    expect(next.items).toHaveLength(3)
    const last = s.activity({ limit: 3, beforeId: next.items[2]!.id })
    expect(last.items).toHaveLength(1)
    expect(last.hasMore).toBe(false)

    expect(s.activity({ projectId: 'p2' }).items.map((i) => i.task.taskId)).toEqual(['t9'])
    expect(s.activity({ group: 'automation' }).items).toHaveLength(1)
    expect(s.activity({ group: 'board' }).items).toHaveLength(5)
  })

  it('"Atualizar" roda o ciclo só dos projetos com quadro e vínculo', async () => {
    await service().refresh()
    expect(refreshed).toEqual(['p1'])
  })

  it('touch agrupa mudanças e avisa com o total', async () => {
    vi.useFakeTimers()
    flows = [gateFlow()]
    const s = service()
    s.touch()
    s.touch()
    await vi.advanceTimersByTimeAsync(20)
    expect(changed).toEqual([1])
    flows = []
    s.touch()
    await vi.advanceTimersByTimeAsync(20)
    expect(changed).toEqual([1, 0])
  })
})

describe('badge do ícone', () => {
  it('macOS/Linux: só o contador; Windows: ponto sobreposto com descrição, removido em zero', () => {
    const counts: number[] = []
    const overlays: [unknown, string][] = []
    const target = (platform: NodeJS.Platform) => ({
      platform,
      setBadgeCount: (n: number) => counts.push(n) > 0,
      windows: () => [{ setOverlayIcon: (icon: unknown, d: string) => overlays.push([icon, d]) }],
      overlayIcon: () => 'dot'
    })
    applyWaitingBadge(target('darwin'), 3)
    expect(counts).toEqual([3])
    expect(overlays).toEqual([])
    applyWaitingBadge(target('win32'), 2)
    applyWaitingBadge(target('win32'), 0)
    expect(overlays).toEqual([
      ['dot', '2 itens esperando você'],
      [null, '']
    ])
    expect(waitingDescription(1)).toBe('1 item esperando você')
  })

  it('ambiente sem suporte não quebra', () => {
    expect(() =>
      applyWaitingBadge(
        {
          platform: 'linux',
          setBadgeCount: () => {
            throw new Error('sem suporte')
          },
          windows: () => [],
          overlayIcon: () => null
        },
        1
      )
    ).not.toThrow()
  })

  it('ponto 16×16 opaco no centro e transparente no canto', () => {
    const buf = overlayDotBitmap(16)
    expect(buf.length).toBe(16 * 16 * 4)
    expect(buf[(8 * 16 + 8) * 4 + 3]).toBe(255)
    expect(buf[3]).toBe(0)
  })
})

describe('filtro da atividade (IPC)', () => {
  it('aceita só campos válidos', () => {
    expect(parseActivityQuery(undefined)).toEqual({})
    expect(
      parseActivityQuery({ projectId: 'p1', group: 'flow', beforeId: 10, limit: 999 })
    ).toEqual({
      projectId: 'p1',
      group: 'flow',
      beforeId: 10,
      limit: 200
    })
    expect(parseActivityQuery({ group: 'hack' })).toBeNull()
    expect(parseActivityQuery({ projectId: '../x' })).toBeNull()
    expect(parseActivityQuery({ beforeId: -1 })).toBeNull()
    expect(parseActivityQuery('x')).toBeNull()
  })
})

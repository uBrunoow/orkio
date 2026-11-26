import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationEvent } from '../../shared/automation'
import type { GitFlowConfig } from '../../shared/git-flow'
import type { NotionTask } from '../../shared/notion'
import type { TaskPullRequest, TaskSignals } from '../../shared/task-signals'
import { BoardStore } from '../board/board.store'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import type { PropertyWrites } from '../connectors/notion/notion.schema'
import { openDatabase, type Db } from '../db/database'
import { ApiError } from '../net/http'
import type { ConfigStore } from '../storage/config-store'
import { GitFlowService } from './git-flow.service'
import { GitFlowStore } from './git-flow.store'

const T1 = '11111111-1111-4111-8111-000000000001'
const T2 = '11111111-1111-4111-8111-000000000002'
const T3 = '11111111-1111-4111-8111-000000000003'

const ORDER = [
  { id: 'o1', name: 'Branch criada' },
  { id: 'o2', name: 'PR aguardando review' },
  { id: 'o3', name: 'Ajustes solicitados' },
  { id: 'o4', name: 'Mergeada na dev' },
  { id: 'o5', name: 'PR para main aberta' },
  { id: 'o6', name: 'Em produção' }
]
const GIT_FLOW: GitFlowConfig = {
  stage: { id: 'eg', name: 'Etapa Git', type: 'select' },
  options: {
    branch: { id: 'o1', name: 'Branch criada' },
    review: { id: 'o2', name: 'PR aguardando review' },
    changes: { id: 'o3', name: 'Ajustes solicitados' },
    merged: { id: 'o4', name: 'Mergeada na dev' }
  },
  prUrl: { id: 'pr', name: 'PR' },
  mergedAt: { id: 'md', name: 'Merge na dev' }
}
const PR_URL = 'https://github.com/acme/app/pull/5'
const MERGED_AT = '2026-11-26T09:00:00Z'

function task(id: string, over: Partial<NotionTask> = {}): NotionTask {
  return {
    id,
    url: null,
    displayId: 'ORK-1',
    title: 'x',
    status: null,
    priority: null,
    assignees: [],
    gitStage: null,
    prUrl: null,
    ...over
  }
}

function pr(over: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 5,
    title: 'ORK-1 algo',
    url: PR_URL,
    state: 'open',
    merged: false,
    headRef: 'ORK-1/x',
    baseRef: 'dev',
    updatedAt: '2026-11-26T08:00:00Z',
    closedAt: null,
    reviewDecision: null,
    unresolvedComments: 0,
    checks: null,
    ...over
  }
}

function signals(taskId: string, p: TaskPullRequest | null, branches: string[] = []): TaskSignals {
  return {
    taskId,
    displayId: 'ORK-1',
    localBranches: branches,
    remoteBranches: [],
    pr: p,
    otherPrs: 0
  }
}

function prEvent(kind: AutomationEvent['kind'], suffix: string): AutomationEvent {
  return { key: `pr#5:${suffix}`, kind, taskId: T1, at: null, pr: { number: 5 } }
}

const OPENED = prEvent('pr.opened', 'opened')
const MERGED = prEvent('pr.merged', 'merged')

describe('GitFlowService', () => {
  let dir: string
  let db: Db
  let config: ConfigStore<OrkioConfig>
  let board: BoardStore
  let gitStore: GitFlowStore
  let service: GitFlowService
  let sent: { pageId: string; writes: PropertyWrites }[]
  let reject: ApiError | null
  let changed: string[]
  let options: typeof ORDER | null

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-gitflow-'))
    await writeFile(
      join(dir, 'c.json'),
      JSON.stringify({
        schemaVersion: 4,
        notion: {
          projectsDataSource: { id: 'ds-proj', name: 'Projetos' },
          tasksDataSource: { id: 'ds', name: 'Tarefas' },
          mapping: {
            title: { id: 'title', name: 'Nome', type: 'title' },
            status: { id: 'st', name: 'Status', type: 'status' },
            project: { id: 'rel', name: 'Projeto', type: 'relation' }
          },
          gitFlow: GIT_FLOW,
          updatedAt: 'x'
        },
        boards: {},
        automation: { paused: false },
        projects: [
          {
            id: 'p1',
            name: 'app',
            localPath: '/x',
            repo: {
              host: 'github.com',
              owner: 'acme',
              name: 'app',
              remoteName: 'origin',
              defaultBranch: 'main',
              visibility: 'private',
              canPush: true,
              archived: false,
              verified: true
            },
            createdAt: 'x',
            updatedAt: 'x',
            notionProject: { id: 'page', name: 'App' }
          }
        ]
      })
    )
    config = createOrkioConfigStore(join(dir, 'c.json'))
    await config.load()
    // O Fluxo Git só observa projetos com quadro (os das automações).
    await config.update((c) => ({ ...c, boards: { p1: { stages: [] } as never } }))
    db = openDatabase(':memory:')
    board = new BoardStore(db)
    gitStore = new GitFlowStore(db)
    sent = []
    reject = null
    changed = []
    options = ORDER
    service = new GitFlowService({
      config,
      store: board,
      gitStore,
      stageOptions: () => options,
      writes: {
        updatePage: async (pageId, writes) => {
          if (reject) throw reject
          sent.push({ pageId, writes })
        },
        now: () => new Date('2026-11-26T12:00:00Z'),
        random: () => 0,
        schedule: () => ({ cancel: () => {} })
      },
      onChanged: (id) => changed.push(id),
      now: () => new Date('2026-11-26T12:00:00Z')
    })
  })

  afterEach(async () => {
    service.writes.stop()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  function apply(over: {
    events?: AutomationEvent[]
    task?: NotionTask | null
    signals?: TaskSignals
    paused?: boolean
  }): boolean {
    return board.transaction((tx) =>
      service.apply(tx, {
        projectId: 'p1',
        taskId: T1,
        events: over.events ?? [OPENED, MERGED],
        task: over.task === undefined ? task(T1) : over.task,
        signals: over.signals ?? signals(T1, pr({ state: 'merged', closedAt: MERGED_AT })),
        paused: over.paused ?? false
      })
    )
  }

  function gitEvents(taskId = T1) {
    return db.all<{ detail_json: string | null; event_key: string | null; kind: string }>(
      "SELECT detail_json, event_key, kind FROM task_events WHERE task_page_id = ? AND kind IN ('git_flow', 'rolled_back') ORDER BY id",
      taskId
    )
  }

  it('aberta + mergeada no mesmo ciclo → uma escrita com a etapa, o link e a data do merge', async () => {
    expect(apply({})).toBe(true)
    await service.writes.kick()
    expect(sent).toEqual([
      {
        pageId: T1,
        writes: {
          eg: { type: 'select', name: 'Mergeada na dev' },
          pr: { type: 'url', url: PR_URL },
          md: { type: 'date', start: MERGED_AT }
        }
      }
    ])
    expect(gitStore.pending(T1)).toBeNull()
    const rows = gitEvents()
    expect(rows.map((r) => r.event_key)).toEqual(['gitflow:pr#5:opened', 'gitflow:pr#5:merged'])
    expect(rows.map((r) => JSON.parse(r.detail_json!))).toEqual([
      { event: 'pr.opened', reason: 'junto com o evento seguinte' },
      { event: 'pr.merged', stage: 'Mergeada na dev', prNumber: 5 }
    ])
  })

  it('a chave gitflow:<evento> impede aplicar de novo', async () => {
    apply({})
    await service.writes.kick()
    expect(apply({})).toBe(false)
    expect(gitStore.pending(T1)).toBeNull()
    await service.writes.kick()
    expect(sent).toHaveLength(1)
  })

  it('sem campo de link/data mapeado: escreve só a etapa', async () => {
    const onlyStage: GitFlowConfig = { stage: GIT_FLOW.stage, options: GIT_FLOW.options }
    await config.update((c) => ({ ...c, notion: { ...c.notion!, gitFlow: onlyStage } }))
    apply({})
    expect(gitStore.pending(T1)!.properties).toEqual({
      eg: { type: 'select', name: 'Mergeada na dev' }
    })
  })

  it('pausada: nada é escrito e os eventos são consumidos', () => {
    expect(apply({ paused: true })).toBe(false)
    expect(gitStore.pending(T1)).toBeNull()
    expect(board.hasEventKey('p1', T1, 'gitflow:pr#5:opened')).toBe(true)
    expect(board.hasEventKey('p1', T1, 'gitflow:pr#5:merged')).toBe(true)
    expect(apply({})).toBe(false)
    expect(gitStore.pending(T1)).toBeNull()
  })

  it('tarefa já "Em produção" no Notion: nada é escrito', () => {
    expect(
      apply({
        task: task(T1, {
          gitStage: { id: 'o6', name: 'Em produção', color: 'green' },
          prUrl: PR_URL
        }),
        events: [MERGED]
      })
    ).toBe(false)
    expect(gitStore.pending(T1)).toBeNull()
  })

  it('PR da tarefa direto para a main: nada é escrito', () => {
    expect(
      apply({ signals: signals(T1, pr({ state: 'merged', baseRef: 'main', closedAt: MERGED_AT })) })
    ).toBe(false)
  })

  it('a etapa desejada é a da escrita pendente: alterações pedidas depois de "aguardando review"', () => {
    expect(apply({ events: [OPENED], signals: signals(T1, pr()) })).toBe(true)
    expect(
      apply({
        events: [prEvent('pr.changes_requested', 'review:rv1')],
        signals: signals(T1, pr({ reviewDecision: 'changes_requested' }))
      })
    ).toBe(true)
    expect(gitStore.pending(T1)!.properties).toEqual({
      eg: { type: 'select', name: 'Ajustes solicitados' },
      pr: { type: 'url', url: PR_URL }
    })
  })

  it('o Notion recusa (400): a pendência sai e o histórico registra, sem rollback do quadro', async () => {
    reject = new ApiError('notion', 'bad_request', 'O Notion recusou o valor.')
    apply({})
    await service.writes.kick()
    expect(gitStore.pending(T1)).toBeNull()
    const rows = gitEvents()
    expect(rows.some((r) => r.kind === 'rolled_back')).toBe(false)
    expect(JSON.parse(rows.at(-1)!.detail_json!)).toEqual({
      stage: 'Mergeada na dev',
      rejected: 'O Notion recusou o valor.'
    })
    expect(changed).toEqual(['p1'])
  })

  it('carga inicial: escreve só onde muda e marca backfilledAt uma vez', async () => {
    const tasks = [
      task(T1),
      task(T2),
      task(T3, { gitStage: { id: 'o4', name: 'Mergeada na dev', color: 'green' }, prUrl: PR_URL })
    ]
    const all = {
      [T1]: signals(T1, pr()),
      [T2]: signals(T2, null),
      [T3]: signals(T3, pr({ state: 'merged', closedAt: MERGED_AT }))
    }
    expect(
      board.transaction((tx) =>
        service.backfill(tx, { projectId: 'p1', tasks, signals: all, githubOk: true })
      )
    ).toBe(1)
    expect(gitStore.allPending().map((w) => w.taskPageId)).toEqual([T1])
    expect(gitStore.pending(T1)!.properties).toEqual({
      eg: { type: 'select', name: 'PR aguardando review' },
      pr: { type: 'url', url: PR_URL }
    })
    await vi.waitFor(() =>
      expect(config.get().notion!.gitFlow!.backfilledAt).toBe('2026-11-26T12:00:00.000Z')
    )
    gitStore.deletePending(T1)
    expect(
      board.transaction((tx) =>
        service.backfill(tx, { projectId: 'p1', tasks, signals: all, githubOk: true })
      )
    ).toBe(0)
    expect(gitStore.allPending()).toEqual([])
    // A gravação da config termina antes de apagar a pasta do teste.
    await config.update((c) => c)
  })

  const backfillOnce = (githubOk: boolean) =>
    board.transaction((tx) =>
      service.backfill(tx, {
        projectId: 'p1',
        tasks: [task(T1)],
        signals: { [T1]: signals(T1, pr()) },
        githubOk
      })
    )

  it('carga inicial sem o GitHub lido: não escreve, mas conta como tentativa e marca backfilledAt', async () => {
    expect(backfillOnce(false)).toBe(0)
    expect(gitStore.allPending()).toEqual([])
    await vi.waitFor(() => expect(config.get().notion!.gitFlow!.backfilledAt).toBeDefined())
    expect(backfillOnce(true)).toBe(0)
    await config.update((c) => c)
  })

  it('carga inicial: desligar e religar na mesma sessão (sem backfilledAt) carrega de novo', async () => {
    expect(backfillOnce(true)).toBe(1)
    await vi.waitFor(() => expect(config.get().notion!.gitFlow!.backfilledAt).toBeDefined())
    expect(backfillOnce(true)).toBe(0) // marcada: o serviço esquece os projetos feitos
    gitStore.deletePending(T1)
    await config.update((c) => ({ ...c, notion: { ...c.notion!, gitFlow: GIT_FLOW } }))
    expect(backfillOnce(true)).toBe(1)
    await config.update((c) => c)
  })

  it('carga inicial: mapeamento mudou no meio (sem marcar) → recomeça', async () => {
    await config.update((c) => ({ ...c, boards: { p1: c.boards['p1']!, p2: c.boards['p1']! } }))
    await config.update((c) => ({
      ...c,
      projects: [...c.projects, { ...c.projects[0]!, id: 'p2' }]
    }))
    expect(backfillOnce(true)).toBe(1)
    expect(backfillOnce(true)).toBe(0) // p1 já tentou; p2 ainda não
    gitStore.deletePending(T1)
    const { mergedAt: _m, ...withoutDate } = GIT_FLOW
    void _m
    await config.update((c) => ({ ...c, notion: { ...c.notion!, gitFlow: withoutDate } }))
    expect(backfillOnce(true)).toBe(1)
    expect(config.get().notion!.gitFlow!.backfilledAt).toBeUndefined()
  })

  it('sem a ordem das opções ou sem a tarefa: consome os eventos com o motivo', () => {
    options = null
    expect(apply({})).toBe(false)
    expect(gitEvents().map((r) => JSON.parse(r.detail_json!))).toEqual([
      { event: 'pr.opened', reason: 'sem os dados do Notion' },
      { event: 'pr.merged', reason: 'sem os dados do Notion' }
    ])
    options = ORDER
    expect(apply({})).toBe(false)
    expect(apply({ events: [prEvent('pr.ready_for_review', 'ready')], task: null })).toBe(false)
    expect(JSON.parse(gitEvents().at(-1)!.detail_json!)).toEqual({
      event: 'pr.ready_for_review',
      reason: 'sem os dados do Notion'
    })
    expect(gitStore.pending(T1)).toBeNull()
  })

  it('a etapa no histórico só com a opção nomeada (nada de "Etapa Git → " vazio)', () => {
    const nameless: GitFlowConfig = {
      ...GIT_FLOW,
      options: { ...GIT_FLOW.options, merged: { id: 'o4', name: '' } }
    }
    return config
      .update((c) => ({ ...c, notion: { ...c.notion!, gitFlow: nameless } }))
      .then(() => {
        expect(apply({ events: [MERGED] })).toBe(true)
        expect(gitStore.pending(T1)!.properties).toEqual({ pr: { type: 'url', url: PR_URL } })
        expect(JSON.parse(gitEvents().at(-1)!.detail_json!)).toEqual({
          event: 'pr.merged',
          prNumber: 5
        })
      })
  })

  it('a linha com a etapa é a do último evento da PR principal, não de outra PR', () => {
    const other: AutomationEvent = {
      key: 'pr#9:review:rv9',
      kind: 'pr.changes_requested',
      taskId: T1,
      at: null,
      pr: { number: 9 }
    }
    expect(apply({ events: [OPENED, other], signals: signals(T1, pr()) })).toBe(true)
    expect(gitEvents().map((r) => [r.event_key, JSON.parse(r.detail_json!)])).toEqual([
      ['gitflow:pr#9:review:rv9', { event: 'pr.changes_requested', reason: 'outra PR da tarefa' }],
      ['gitflow:pr#5:opened', { event: 'pr.opened', stage: 'PR aguardando review', prNumber: 5 }]
    ])
  })
})

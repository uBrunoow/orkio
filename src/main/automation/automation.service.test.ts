import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusOption } from '../../shared/board'
import type { TaskPullRequest, TaskSignals, TaskSignalsResult } from '../../shared/task-signals'
import { BoardService, type BoardNotion } from '../board/board.service'
import { BoardStore } from '../board/board.store'
import type { NotionWriteQueue } from '../board/write-queue'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import {
  encodePropertyWrites,
  type PropertyWrites,
  type SimplePropertyValue
} from '../connectors/notion/notion.schema'
import { openDatabase, type Db } from '../db/database'
import type { ConfigStore } from '../storage/config-store'
import {
  AutomationService,
  type AutomationNotification,
  type AutomationServiceDeps
} from './automation.service'
import type { NotionMapping, NotionPropertySummary, NotionTask } from '../../shared/notion'
import { ApiError } from '../net/http'

const OPTIONS: StatusOption[] = [
  { id: 'o-prio', name: 'Prioridades', color: 'gray' },
  { id: 'o-and', name: 'Em andamento', color: 'blue' },
  { id: 'o-fin', name: 'Finalizadas', color: 'green' }
]
const MAPPING: NotionMapping = {
  title: { id: 'title', name: 'Nome', type: 'title' },
  status: { id: 'st', name: 'Status', type: 'status' },
  uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
  project: { id: 'rel', name: 'Projeto', type: 'relation' }
}
const T1 = '11111111-1111-4111-8111-000000000001'
const T2 = '11111111-1111-4111-8111-000000000002'
const DISPLAY: Record<string, string> = { [T1]: 'ORK-1', [T2]: 'ORK-2' }

class FakeNotion implements BoardNotion {
  status: Record<string, string> = { [T1]: 'Prioridades', [T2]: 'Em andamento' }
  offline = false
  writes: { pageId: string; properties: Record<string, unknown> }[] = []
  async boardTasks() {
    if (this.offline)
      return { ok: false as const, error: { code: 'network', message: 'Sem conexão.' } }
    const tasks: NotionTask[] = Object.entries(this.status).map(([id, name]) => ({
      id,
      url: null,
      displayId: DISPLAY[id]!,
      title: 'x',
      status: { id: OPTIONS.find((o) => o.name === name)!.id, name, color: 'blue' },
      priority: null,
      assignees: [],
      gitStage: null,
      prUrl: null
    }))
    const values: Record<string, Record<string, SimplePropertyValue>> = {}
    for (const t of tasks)
      values[t.id] = { st: { type: 'status', id: t.status!.id!, name: t.status!.name } }
    return {
      ok: true as const,
      value: {
        tasks,
        values,
        truncated: false,
        fetchedAt: 'x',
        fromCache: false,
        mapping: MAPPING,
        tasksDataSourceId: 'ds'
      }
    }
  }
  async statusOptions() {
    if (this.offline)
      return { ok: false as const, error: { code: 'network', message: 'Sem conexão.' } }
    const properties: NotionPropertySummary[] = [
      { id: 'st', name: 'Status', type: 'status', options: OPTIONS }
    ]
    return { ok: true as const, value: { options: OPTIONS, statusType: 'status', properties } }
  }
  invalidateTasks(): void {}
  async updateDataSource() {
    return {}
  }
  async connectionMethod() {
    return 'oauth' as const
  }
  async updatePage(pageId: string, writes: PropertyWrites): Promise<void> {
    const properties = encodePropertyWrites(writes)
    if (this.offline) throw new ApiError('notion', 'network', 'Sem conexão.')
    this.writes.push({ pageId, properties })
    const st = properties['st'] as { status?: { name: string } } | undefined
    if (st?.status) this.status[pageId] = st.status.name
  }
}

/** "Mundo" do git/GitHub simulado, convertido em TaskSignalsResult. */
interface World {
  github: TaskSignalsResult['github']
  local: Record<string, string[]>
  remote: Record<string, string[]>
  pr: Record<string, Partial<TaskPullRequest> | null>
}

function prOf(over: Partial<TaskPullRequest>): TaskPullRequest {
  return {
    number: 5,
    title: 'ORK-1 algo',
    url: 'https://github.com/acme/app/pull/5',
    state: 'open',
    merged: false,
    headRef: 'ORK-1/x',
    updatedAt: '2026-11-19T10:00:00Z',
    closedAt: null,
    reviewDecision: null,
    unresolvedComments: 0,
    checks: null,
    reviewRequests: [],
    reviews: [],
    unresolvedThreadIds: [],
    ...over
  }
}

describe('AutomationService (regras padrão ponta a ponta)', () => {
  let dir: string
  let db: Db
  let config: ConfigStore<OrkioConfig>
  let notion: FakeNotion
  let world: World
  let board: BoardService
  let queue: NotionWriteQueue
  let automation: AutomationService
  let notifications: AutomationNotification[]
  let changed: string[]
  let clock: number
  const signalForces: boolean[] = []

  function build(gitFlow?: AutomationServiceDeps['gitFlow']): void {
    const store = new BoardStore(db)
    board = new BoardService({
      config,
      store,
      notion,
      writes: {
        updatePage: (id, p) => notion.updatePage(id, p),
        now: () => new Date(clock),
        random: () => 0,
        schedule: () => ({ cancel: () => {} })
      },
      onSync: () => {},
      enterStage: () => undefined,
      now: () => new Date(clock),
      newId: (() => {
        let n = 0
        return () => `stage-${++n}`
      })()
    })
    queue = board.writes
    automation = new AutomationService({
      config,
      store,
      board,
      signals: {
        get: async (_projectId, options) => {
          signalForces.push(options?.force === true)
          const signals: Record<string, TaskSignals> = {}
          for (const id of [T1, T2]) {
            const pr = world.pr[id]
            signals[id] = {
              taskId: id,
              displayId: DISPLAY[id]!,
              localBranches: world.local[id] ?? [],
              remoteBranches: world.remote[id] ?? [],
              pr: pr ? prOf(pr) : null,
              otherPrs: 0
            }
          }
          return {
            ok: true,
            value: {
              signals,
              github: world.github,
              local: true,
              messages: [],
              tasksWithoutPrefix: 0,
              fetchedAt: 'x'
            }
          }
        }
      },
      notify: (n) => notifications.push(n),
      onChanged: (id) => changed.push(id),
      ...(gitFlow ? { gitFlow } : {}),
      now: () => new Date(clock)
    })
  }

  async function stageOf(taskId: string): Promise<string | null> {
    const view = await board.get('p1')
    if (!view.ok) throw new Error(view.error.message)
    const card = view.value.cards.find((c) => c.taskId === taskId)!
    return view.value.config!.stages.find((s) => s.id === card.stageId)?.name ?? null
  }

  async function cycle() {
    clock += 60_000
    const r = await automation.run('p1')
    await queue.kick()
    return r
  }

  async function history(taskId: string) {
    const h = await board.history('p1', taskId)
    if (!h.ok) throw new Error(h.error.message)
    return h.value
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-auto-'))
    await writeFile(
      join(dir, 'c.json'),
      JSON.stringify({
        schemaVersion: 4,
        notion: {
          projectsDataSource: { id: 'ds-proj', name: 'Projetos' },
          tasksDataSource: { id: 'ds', name: 'Tarefas' },
          mapping: MAPPING,
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
    db = openDatabase(join(dir, 'orkio.db'))
    notion = new FakeNotion()
    world = { github: 'ok', local: {}, remote: {}, pr: {} }
    notifications = []
    changed = []
    clock = Date.parse('2026-11-19T12:00:00Z')
    build()
    // Cria o quadro com o template (e as regras padrão).
    const first = await board.get('p1')
    if (!first.ok) throw new Error(first.error.message)
    const saved = await board.save('p1', {
      stages: first.value.suggestion!.map((s) => ({
        id: s.id,
        name: s.name,
        notionStatusId: s.notionStatus.id!,
        ...(s.role ? { role: s.role } : {})
      })),
      orkioStage: { mode: 'none' },
      addMissingOptions: false,
      blockedPropertyId: null
    })
    if (!saved.ok) throw new Error(saved.error.message)
    expect(saved.value.config!.rules).toHaveLength(8)
  })

  afterEach(async () => {
    queue.stop()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('"Atualizar" durante um ciclo comum espera e roda um ciclo forçado (não devolve o velho)', async () => {
    signalForces.length = 0
    const plain = automation.run('p1')
    const forced = automation.run('p1', { force: true })
    const again = automation.run('p1')
    await Promise.all([plain, forced, again])
    expect(signalForces).toEqual([false, true])
  })

  it('primeiro ciclo é linha de base: nada se move', async () => {
    world.local[T1] = ['ORK-1/x']
    world.pr[T2] = { number: 9, state: 'merged', closedAt: 'x' }
    expect(await cycle()).toMatchObject({ events: 0, moves: 0 })
    expect(await stageOf(T1)).toBe('Prioridades')
    expect(await stageOf(T2)).toBe('Em andamento')
  })

  it('ciclo completo: branch → aberta → alterações → novo pedido → merge, e o Notion fica "Finalizadas"', async () => {
    await cycle() // linha de base

    world.local[T1] = ['ORK-1/x']
    expect(await cycle()).toMatchObject({ events: 1, moves: 1 })
    expect(await stageOf(T1)).toBe('Em andamento')
    expect(notion.status[T1]).toBe('Em andamento')

    world.pr[T1] = {}
    await cycle()
    expect(await stageOf(T1)).toBe('Revisando')

    world.pr[T1] = {
      reviews: [{ id: 'rv1', state: 'changes_requested', at: '2026-11-19T12:30:00Z' }]
    }
    await cycle()
    expect(await stageOf(T1)).toBe('Revisado')

    world.pr[T1] = {
      reviews: [{ id: 'rv1', state: 'changes_requested', at: '2026-11-19T12:30:00Z' }],
      reviewRequests: [{ id: 'rr2', at: '2026-11-19T13:00:00Z' }]
    }
    await cycle()
    expect(await stageOf(T1)).toBe('Revisando')

    world.pr[T1] = {
      ...world.pr[T1],
      state: 'merged',
      merged: true,
      closedAt: '2026-11-19T14:00:00Z'
    }
    await cycle()
    expect(await stageOf(T1)).toBe('Finalizada')
    expect(notion.status[T1]).toBe('Finalizadas')

    const h = await history(T1)
    const moves = h.filter((e) => e.kind === 'moved' && e.source === 'automation')
    expect(moves.map((e) => (e.kind === 'moved' ? e.detail.ruleId : null))).toEqual([
      'default-merged',
      'default-rerequest',
      'default-changes',
      'default-pr-opened',
      'default-branch'
    ])
    expect(moves[0]?.detail).toMatchObject({
      event: 'pr.merged',
      pr: { number: 5, owner: 'acme', repo: 'app' }
    })
    expect(changed.length).toBeGreaterThan(0)
  })

  it('nova revisão pedida pelo Orkio com o revisor já pendente: aplica a regra de "review pedido" na hora', async () => {
    await cycle()
    world.local[T1] = ['ORK-1/x']
    world.pr[T1] = { reviewRequests: [{ id: 'rr1', at: '2026-11-19T12:00:00Z' }] }
    await cycle()
    world.pr[T1] = {
      reviewRequests: [{ id: 'rr1', at: '2026-11-19T12:00:00Z' }],
      reviews: [{ id: 'rv1', state: 'changes_requested', at: '2026-11-19T12:30:00Z' }]
    }
    await cycle()
    expect(await stageOf(T1)).toBe('Revisado')
    // O GitHub não acusa pedido novo (o revisor continua pendente): sem o Orkio, ficaria em Revisado.
    expect(automation.applyEvent('p1', T1, 'pr.review_requested', 5)).toBe(true)
    expect(await stageOf(T1)).toBe('Revisando')
    const h = await history(T1)
    expect(h[0]).toMatchObject({
      kind: 'moved',
      detail: { ruleId: 'default-rerequest', event: 'pr.review_requested' }
    })
    // A próxima revisão com alterações volta para Revisado (e o corretor roda de novo).
    world.pr[T1] = {
      ...world.pr[T1],
      reviews: [
        { id: 'rv1', state: 'changes_requested', at: '2026-11-19T12:30:00Z' },
        { id: 'rv2', state: 'changes_requested', at: '2026-11-19T13:30:00Z' }
      ]
    }
    await cycle()
    expect(await stageOf(T1)).toBe('Revisado')
    // Fora da coluna da regra (ou pausada): não move, só registra.
    await board.setAutomationPaused('p1', T1, true)
    expect(automation.applyEvent('p1', T1, 'pr.review_requested', 5)).toBe(false)
    expect(await stageOf(T1)).toBe('Revisado')
  })

  it('idempotência: repetir o ciclo e reiniciar o app não repetem automações', async () => {
    await cycle()
    // A foto dos sinais antes da PR existir (para voltar a ela no fim).
    const beforePr = new BoardStore(db).snapshots('p1')
    world.pr[T1] = {}
    await cycle()
    expect(await stageOf(T1)).toBe('Revisando')
    const before = (await history(T1)).length
    const writes = notion.writes.length

    await cycle()
    await cycle()
    // "Reinicia": novos serviços sobre o mesmo banco; o mesmo mundo.
    queue.stop()
    db.close()
    db = openDatabase(join(dir, 'orkio.db'))
    build()
    await board.get('p1')
    expect(await cycle()).toMatchObject({ events: 0, moves: 0 })
    expect((await history(T1)).length).toBe(before)
    expect(notion.writes.length).toBe(writes)

    // Mesmo que a foto volte a ser a de antes da PR (a abertura aparece de novo no diff), a chave
    // do evento impede repetir.
    const store = new BoardStore(db)
    for (const [taskId, snapshot] of beforePr) store.saveSnapshot(taskId, 'p1', snapshot, 'x')
    expect(await cycle()).toMatchObject({ moves: 0 })
    expect(await stageOf(T1)).toBe('Revisando')
    expect((await history(T1)).length).toBe(before)
  })

  // Bug: a chave (`pr#5:opened`, `branch:local:<nome>`) era única no banco inteiro.
  it('idempotência por projeto e tarefa: a PR #5 de outro projeto e a mesma PR em outra tarefa disparam', async () => {
    await cycle() // linha de base
    // A PR #5 de outro projeto já foi processada antes.
    new BoardStore(db).addEvent({
      taskPageId: 'tarefa-de-outro-projeto',
      projectId: 'p-outro',
      at: 'x',
      kind: 'automation',
      fromStage: null,
      toStage: null,
      detail: { event: 'pr.opened', ruleId: null, ruleName: null, outcome: 'no_rule' },
      eventKey: 'pr#5:opened'
    })
    // As duas tarefas citam a mesma PR #5.
    world.pr[T1] = {}
    world.pr[T2] = {}
    expect(await cycle()).toMatchObject({ events: 2, moves: 2 })
    expect(await stageOf(T1)).toBe('Revisando')
    expect(await stageOf(T2)).toBe('Revisando')
    // E cada uma continua sem repetir.
    expect(await cycle()).toMatchObject({ events: 0, moves: 0 })
  })

  // Decisão: branch apagada e recriada com o mesmo nome na MESMA tarefa não dispara de novo (o
  // "começou o trabalho" já aconteceu; recriar costuma ser o push de novo depois de o GitHub apagar
  // a branch no merge, ou a lista de branches oscilando, e puxaria a tarefa de volta). Outra tarefa
  // com a mesma branch é outro evento.
  it('branch recriada na mesma tarefa não dispara de novo; a mesma branch em outra tarefa dispara', async () => {
    await cycle() // linha de base
    world.local[T1] = ['feat/x']
    await cycle()
    expect(await stageOf(T1)).toBe('Em andamento')

    const view = await board.get('p1')
    if (!view.ok) throw new Error(view.error.message)
    const prio = view.value.config!.stages.find((s) => s.name === 'Prioridades')!.id
    await board.move('p1', T1, prio)
    await board.move('p1', T2, prio)
    world.local[T1] = []
    await cycle()
    world.local[T1] = ['feat/x']
    expect(await cycle()).toMatchObject({ events: 0, moves: 0 })
    expect(await stageOf(T1)).toBe('Prioridades')

    world.local[T2] = ['feat/x']
    expect(await cycle()).toMatchObject({ events: 1, moves: 1 })
    expect(await stageOf(T2)).toBe('Em andamento')
  })

  it('pausada (tarefa e global) e bloqueada: não move e registra no histórico', async () => {
    await cycle()
    await board.setAutomationPaused('p1', T2, true)
    world.pr[T2] = { number: 8, title: 'ORK-2 x', headRef: 'ORK-2/x' }
    expect(await cycle()).toMatchObject({ events: 1, moves: 0 })
    expect(await stageOf(T2)).toBe('Em andamento')
    const h = await history(T2)
    expect(h[0]).toMatchObject({
      kind: 'automation',
      detail: {
        outcome: 'skipped',
        reason: 'automações pausadas nesta tarefa',
        ruleId: 'default-pr-opened'
      }
    })
    expect(h.some((e) => e.kind === 'automation_paused')).toBe(true)

    // Global.
    await config.update((c) => ({ ...c, automation: { paused: true } }))
    world.local[T1] = ['ORK-1/y']
    await cycle()
    expect(await stageOf(T1)).toBe('Prioridades')
    expect((await history(T1))[0]?.detail).toMatchObject({
      reason: 'automações pausadas para todos os projetos'
    })
    await config.update((c) => ({ ...c, automation: { paused: false } }))

    // Bloqueada.
    await board.setBlocked('p1', T1, true)
    world.local[T1] = ['ORK-1/y', 'ORK-1/z']
    await cycle()
    expect(await stageOf(T1)).toBe('Prioridades')
    expect((await history(T1))[0]?.detail).toMatchObject({ reason: 'tarefa bloqueada' })
    // Despausar não reaplica o evento consumido.
    await config.update((c) => c)
    await board.setBlocked('p1', T1, false)
    await cycle()
    expect(await stageOf(T1)).toBe('Prioridades')
  })

  it('conflito: movimento manual depois do evento no GitHub vence', async () => {
    world.pr[T1] = { reviewRequests: [], reviews: [] }
    await cycle()
    const view = await board.get('p1')
    const fin = view.ok ? view.value.config!.stages.find((s) => s.name === 'Revisando')!.id : ''
    await board.move('p1', T1, fin)
    // Review submetida ANTES do movimento manual (relógio: 12:01).
    world.pr[T1] = {
      reviews: [{ id: 'old', state: 'changes_requested', at: '2026-11-19T11:00:00Z' }]
    }
    await cycle()
    expect(await stageOf(T1)).toBe('Revisando')
    expect((await history(T1))[0]?.detail).toMatchObject({
      outcome: 'skipped',
      reason: 'a tarefa foi movida manualmente depois do evento'
    })
  })

  it('GitHub indisponível não gera eventos; ao voltar, o merge feito no meio dispara uma vez', async () => {
    world.pr[T2] = { number: 8, title: 'ORK-2', headRef: 'ORK-2/x' }
    await cycle()
    world.github = 'rate_limited'
    world.pr[T2] = null
    expect(await cycle()).toMatchObject({ events: 0 })
    world.github = 'ok'
    world.pr[T2] = {
      number: 8,
      title: 'ORK-2',
      headRef: 'ORK-2/x',
      state: 'merged',
      closedAt: '2026-11-19T15:00:00Z'
    }
    expect(await cycle()).toMatchObject({ events: 1, moves: 1 })
    expect(await stageOf(T2)).toBe('Finalizada')
  })

  it('Notion fora do ar: o movimento fica pendente e sincroniza depois (o evento não se perde)', async () => {
    await cycle()
    notion.offline = true
    world.pr[T2] = {
      number: 8,
      title: 'ORK-2',
      headRef: 'ORK-2/x',
      state: 'merged',
      closedAt: '2026-11-19T15:00:00Z'
    }
    // O quadro já foi carregado nesta sessão: o ciclo segue com as tarefas conhecidas.
    expect(await cycle()).toMatchObject({ moves: 1 })
    expect(notion.status[T2]).toBe('Em andamento')
    notion.offline = false
    clock += 10 * 60_000
    queue.kick()
    await queue.kick()
    expect(notion.status[T2]).toBe('Finalizadas')
    expect(await cycle()).toMatchObject({ events: 0, moves: 0 })
  })

  function fakeGitFlow() {
    return {
      apply: vi.fn((): boolean => true),
      backfill: vi.fn((): number => 0),
      writes: { kick: vi.fn(async () => {}) } as unknown as NotionWriteQueue<never>
    }
  }

  it('Fluxo Git: o merge move o card pela regra e chama o Fluxo Git com os mesmos eventos', async () => {
    await config.update((c) => ({
      ...c,
      notion: {
        ...c.notion!,
        gitFlow: { stage: { id: 'eg', name: 'Etapa Git', type: 'select' }, options: {} }
      }
    }))
    const gitFlow = fakeGitFlow()
    build(gitFlow)
    world.pr[T1] = { baseRef: 'dev' }
    await cycle() // linha de base (com a carga inicial)
    expect(gitFlow.backfill).toHaveBeenCalledTimes(1)
    const backfillCall = gitFlow.backfill.mock.calls[0] as unknown as [
      unknown,
      { projectId: string }
    ]
    expect(backfillCall[1]).toMatchObject({ projectId: 'p1' })
    expect(gitFlow.apply).not.toHaveBeenCalled()

    world.pr[T1] = { baseRef: 'dev', state: 'merged', closedAt: '2026-11-19T12:30:00Z' }
    await cycle()
    expect(await stageOf(T1)).toBe('Finalizada')
    expect(gitFlow.apply).toHaveBeenCalledTimes(1)
    const input = (gitFlow.apply.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]
    expect(input).toMatchObject({
      projectId: 'p1',
      taskId: T1,
      task: { id: T1 },
      signals: { taskId: T1 },
      paused: false
    })
    expect((input['events'] as { kind: string }[]).map((e) => e.kind)).toEqual(['pr.merged'])
    expect(gitFlow.writes.kick).toHaveBeenCalled()
  })

  it('Fluxo Git: sem o mapeamento no Notion, não chama', async () => {
    const gitFlow = fakeGitFlow()
    build(gitFlow)
    await cycle()
    world.pr[T1] = { state: 'merged', closedAt: '2026-11-19T12:30:00Z' }
    await cycle()
    expect(await stageOf(T1)).toBe('Finalizada')
    expect(gitFlow.apply).not.toHaveBeenCalled()
    expect(gitFlow.backfill).not.toHaveBeenCalled()
  })

  it('PR fechada sem merge → Em andamento com notificação de desktop', async () => {
    world.pr[T2] = { number: 8, title: 'ORK-2', headRef: 'ORK-2/x' }
    await cycle()
    world.pr[T2] = {
      number: 8,
      title: 'ORK-2',
      headRef: 'ORK-2/x',
      state: 'closed',
      closedAt: '2026-11-19T15:00:00Z'
    }
    // Já estava em Em andamento → noop (sem notificação). Coloca em Revisando antes.
    const view = await board.get('p1')
    const rev = view.ok ? view.value.config!.stages.find((s) => s.name === 'Revisando')!.id : ''
    await board.move('p1', T2, rev)
    clock += 60 * 60_000
    await cycle()
    expect(await stageOf(T2)).toBe('Em andamento')
    expect(notifications).toEqual([
      {
        projectId: 'p1',
        taskId: T2,
        title: 'ORK-2 → Em andamento',
        body: 'PR fechada sem merge (PR #8)'
      }
    ])
  })
})

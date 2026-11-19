import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatusOption } from '../../shared/board'
import type {
  BoardSaveInput,
  BoardSyncEvent,
  NotionMapping,
  NotionPropertySummary,
  NotionTask
} from '../../shared/ipc-contract'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import { NotionApiError } from '../connectors/notion/notion.client'
import type { SimplePropertyValue } from '../connectors/notion/notion.schema'
import { openDatabase, type Db } from '../db/database'
import type { ConfigStore } from '../storage/config-store'
import { BoardService, type BoardNotion } from './board.service'
import { BoardStore } from './board.store'
import { NotionWriteQueue } from './write-queue'

const OPTIONS: StatusOption[] = [
  { id: 'o-prio', name: 'Prioridades', color: 'gray' },
  { id: 'o-and', name: 'Em andamento', color: 'blue' },
  { id: 'o-fin', name: 'Finalizadas', color: 'green' },
  { id: 'o-back', name: 'Backlog', color: 'default' }
]

const MAPPING: NotionMapping = {
  title: { id: 'title', name: 'Nome', type: 'title' },
  status: { id: 'st', name: 'Status', type: 'status' },
  uniqueId: { id: 'uid', name: 'ID', type: 'unique_id' },
  project: { id: 'rel', name: 'Projeto', type: 'relation' }
}

const T1 = '11111111-1111-4111-8111-000000000001'
const T2 = '11111111-1111-4111-8111-000000000002'

/** Notion simulado: status por tarefa, select/checkbox extras e schema. */
class FakeNotion implements BoardNotion {
  status: Record<string, string> = { [T1]: 'Em andamento', [T2]: 'Prioridades' }
  extras: Record<string, Record<string, SimplePropertyValue>> = {}
  properties: NotionPropertySummary[] = [
    { id: 'st', name: 'Status', type: 'status', options: OPTIONS },
    { id: 'blk', name: 'Bloqueada', type: 'checkbox' },
    {
      id: 'sel',
      name: 'Fase',
      type: 'select',
      options: [{ id: 'f1', name: 'Prioridades', color: 'gray' }]
    }
  ]
  offline = false
  writes: { pageId: string; properties: Record<string, unknown> }[] = []
  dataSourceUpdates: Record<string, unknown>[] = []
  reject: string | null = null
  invalidated = 0

  async boardTasks() {
    if (this.offline) {
      return { ok: false as const, error: { code: 'network', message: 'Sem conexão.' } }
    }
    const tasks: NotionTask[] = Object.entries(this.status).map(([id, name], i) => ({
      id,
      url: `https://www.notion.so/${i}`,
      displayId: `ORK-${i + 1}`,
      title: `Tarefa ${i + 1}`,
      status: { id: OPTIONS.find((o) => o.name === name)?.id ?? null, name, color: 'blue' },
      priority: null,
      assignees: ['Ada']
    }))
    const values: Record<string, Record<string, SimplePropertyValue>> = {}
    for (const t of tasks) {
      values[t.id] = {
        st: { type: 'status', id: t.status!.id ?? null, name: t.status!.name },
        ...this.extras[t.id]
      }
    }
    return {
      ok: true as const,
      value: {
        tasks,
        values,
        truncated: false,
        fetchedAt: '2026-11-19T12:00:00.000Z',
        fromCache: false,
        mapping: MAPPING,
        tasksDataSourceId: 'ds-tasks'
      }
    }
  }

  async statusOptions() {
    if (this.offline) {
      return { ok: false as const, error: { code: 'network', message: 'Sem conexão.' } }
    }
    return {
      ok: true as const,
      value: { options: OPTIONS, statusType: 'status', properties: this.properties }
    }
  }

  invalidateTasks(): void {
    this.invalidated++
  }

  async updateDataSource(_id: string, properties: Record<string, unknown>) {
    this.dataSourceUpdates.push(properties)
    return {
      object: 'data_source',
      properties: { 'Etapa Orkio': { id: 'eo-new', type: 'select' } }
    }
  }

  async connectionMethod() {
    return 'oauth' as const
  }

  /** PATCH /pages/{id}. */
  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    if (this.offline) throw new NotionApiError('network', 'Sem conexão.')
    if (this.reject) throw new NotionApiError('bad_request', 'Recusado.', 400)
    this.writes.push({ pageId, properties })
    const st = properties['st'] as { status?: { name: string } } | undefined
    if (st?.status) this.status[pageId] = st.status.name
    for (const [prop, value] of Object.entries(properties)) {
      if (prop === 'st') continue
      const v = value as { checkbox?: boolean; select?: { name: string } }
      this.extras[pageId] ??= {}
      this.extras[pageId][prop] =
        typeof v.checkbox === 'boolean'
          ? { type: 'checkbox', checked: v.checkbox }
          : { type: 'select', id: null, name: v.select?.name ?? null }
    }
  }
}

const DEFAULT_INPUT = (
  stages: { id: string | null; name: string; notionStatusId: string }[]
): BoardSaveInput => ({
  stages,
  orkioStage: { mode: 'none' },
  addMissingOptions: false,
  blockedPropertyId: null
})

describe('BoardService', () => {
  let dir: string
  let db: Db
  let config: ConfigStore<OrkioConfig>
  let notion: FakeNotion
  let events: BoardSyncEvent[]
  let service: BoardService
  let queue: NotionWriteQueue
  let clock: number
  let seq: number

  function build(): void {
    const store = new BoardStore(db)
    service = new BoardService({
      config,
      store,
      notion,
      onSync: (e) => events.push(e),
      now: () => new Date(clock),
      newId: () => `stage-${++seq}`,
      graceMs: 30_000
    })
    queue = new NotionWriteQueue({
      store,
      updatePage: (id, props) => notion.updatePage(id, props),
      onSynced: (w) => service.onSynced(w),
      onRejected: (w, e) => void service.onRejected(w, e),
      onRetry: (w, e) => service.onRetry(w, e),
      now: () => new Date(clock),
      random: () => 0,
      schedule: () => ({ cancel: () => {} })
    })
    service.attachQueue(queue)
  }

  async function createBoard(input?: Partial<BoardSaveInput>) {
    const first = await service.get('p1')
    if (!first.ok) throw new Error(first.error.message)
    const stages = (first.value.suggestion ?? first.value.config!.stages).map((s) => ({
      id: s.id,
      name: s.name,
      notionStatusId: s.notionStatus.id!
    }))
    const saved = await service.save('p1', { ...DEFAULT_INPUT(stages), ...input })
    if (!saved.ok) throw new Error(saved.error.message)
    return saved.value
  }

  function stageId(
    view: { config: { stages: { id: string; name: string }[] } | null },
    name: string
  ) {
    return view.config!.stages.find((s) => s.name === name)!.id
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-board-'))
    await writeFile(
      join(dir, 'c.json'),
      JSON.stringify({
        schemaVersion: 3,
        notion: {
          projectsDataSource: { id: 'ds-proj', name: 'Projetos' },
          tasksDataSource: { id: 'ds-tasks', name: 'Tarefas' },
          mapping: MAPPING,
          updatedAt: 'x'
        },
        boards: {},
        projects: [
          {
            id: 'p1',
            name: 'orkio',
            localPath: '/x',
            repo: null,
            createdAt: 'x',
            updatedAt: 'x',
            notionProject: { id: 'page', name: 'Orkio' }
          }
        ]
      })
    )
    config = createOrkioConfigStore(join(dir, 'c.json'))
    await config.load()
    db = openDatabase(join(dir, 'orkio.db'))
    notion = new FakeNotion()
    events = []
    clock = Date.parse('2026-11-19T12:00:00Z')
    seq = 0
    build()
  })

  afterEach(async () => {
    queue.stop()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('critério 1: sem quadro → sugestão das 5 etapas mapeadas para as opções reais', async () => {
    const result = await service.get('p1')
    expect(result.ok && result.value.config).toBeNull()
    if (!result.ok) return
    expect(
      result.value.suggestion!.map((s) => [s.name, s.notionStatus.name, s.notionStatus.id])
    ).toEqual([
      ['Prioridades', 'Prioridades', 'o-prio'],
      ['Em andamento', 'Em andamento', 'o-and'],
      ['Revisando', 'Em andamento', 'o-and'],
      ['Revisado', 'Em andamento', 'o-and'],
      ['Finalizada', 'Finalizadas', 'o-fin']
    ])
  })

  it('salvar etapa com opção inexistente é recusado', async () => {
    const result = await service.save(
      'p1',
      DEFAULT_INPUT([{ id: null, name: 'Fazendo', notionStatusId: 'nao-existe' }])
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid', message: /não existe/ } })
    expect(config.get().boards['p1']).toBeUndefined()
  })

  it('ao criar, as tarefas entram na primeira etapa com o status (evento source=notion)', async () => {
    const view = await createBoard()
    expect(view.cards.map((c) => [c.taskId, c.stageId])).toEqual([
      [T1, stageId(view, 'Em andamento')],
      [T2, stageId(view, 'Prioridades')]
    ])
    const history = await service.history('p1', T1)
    expect(history).toMatchObject({ ok: true, value: [{ kind: 'added', source: 'notion' }] })
  })

  it('critério 2: mover para Revisando grava a etapa fina e NÃO escreve status no Notion', async () => {
    const view = await createBoard()
    const rev = stageId(view, 'Revisando')
    const moved = await service.move('p1', T1, rev)
    expect(moved).toMatchObject({ ok: true, value: { stageId: rev, sync: { state: 'synced' } } })
    await queue.idle()
    expect(notion.writes).toEqual([])
    // Reabrir mantém Revisando (status do Notion continua compatível).
    const again = await service.get('p1', { force: true })
    expect(again.ok && again.value.cards.find((c) => c.taskId === T1)?.stageId).toBe(rev)
    expect((await service.history('p1', T1)).ok).toBe(true)
  })

  it('critério 3: mover para Finalizada escreve "Finalizadas" no Notion', async () => {
    const view = await createBoard()
    const fin = stageId(view, 'Finalizada')
    const moved = await service.move('p1', T1, fin)
    expect(moved).toMatchObject({ ok: true, value: { stageId: fin, sync: { state: 'pending' } } })
    await queue.idle()
    expect(notion.writes).toEqual([
      { pageId: T1, properties: { st: { status: { name: 'Finalizadas' } } } }
    ])
    expect(notion.status[T1]).toBe('Finalizadas')
    expect(events.at(-1)).toMatchObject({ taskId: T1, state: 'synced', stageId: fin })
    expect(notion.invalidated).toBeGreaterThan(0)
  })

  it('logo depois de sincronizar, uma leitura atrasada do Notion não desfaz o card; "Atualizar" confia no Notion', async () => {
    const view = await createBoard()
    const fin = stageId(view, 'Finalizada')
    await service.move('p1', T1, fin)
    await queue.idle()
    // Notion ainda devolve o valor antigo (consistência eventual).
    notion.status[T1] = 'Em andamento'
    const quick = await service.get('p1')
    expect(quick.ok && quick.value.cards.find((c) => c.taskId === T1)?.stageId).toBe(fin)
    const forced = await service.get('p1', { force: true })
    expect(forced.ok && forced.value.cards.find((c) => c.taskId === T1)?.stageId).toBe(
      stageId(view, 'Em andamento')
    )
  })

  it('critério 4: mudança direto no Notion reposiciona o card ao atualizar', async () => {
    const view = await createBoard()
    await service.move('p1', T1, stageId(view, 'Revisado'))
    notion.status[T1] = 'Finalizadas'
    const again = await service.get('p1', { force: true })
    expect(again.ok && again.value.cards.find((c) => c.taskId === T1)?.stageId).toBe(
      stageId(view, 'Finalizada')
    )
    const history = await service.history('p1', T1)
    expect(history.ok && history.value[0]).toMatchObject({ kind: 'reconciled', source: 'notion' })
  })

  it('critério 5: sem internet fica pendente, sobrevive a reabrir e sincroniza depois', async () => {
    const view = await createBoard()
    const fin = stageId(view, 'Finalizada')
    notion.offline = true
    await service.move('p1', T1, fin)
    await queue.idle()
    expect(events.at(-1)).toMatchObject({
      state: 'pending',
      message: expect.stringContaining('Sem conexão')
    })

    // "Fecha o app": novo serviço/fila sobre o mesmo banco.
    queue.stop()
    db.close()
    db = openDatabase(join(dir, 'orkio.db'))
    build()
    notion.offline = false
    const reopened = await service.get('p1')
    // Pendente: não é reposicionado pelo status antigo do Notion.
    expect(reopened.ok && reopened.value.cards.find((c) => c.taskId === T1)).toMatchObject({
      stageId: fin,
      sync: { state: 'pending' }
    })
    expect(reopened.ok && reopened.value.pendingCount).toBe(1)
    clock += 60_000
    queue.start()
    await queue.idle()
    expect(notion.status[T1]).toBe('Finalizadas')
    expect(events.at(-1)).toMatchObject({ state: 'synced' })
  })

  it('Notion recusa → rollback para a etapa anterior, evento e mensagem', async () => {
    const view = await createBoard()
    const before = stageId(view, 'Em andamento')
    notion.reject = 'bad_request'
    await service.move('p1', T1, stageId(view, 'Finalizada'))
    await queue.idle()
    await new Promise((r) => setTimeout(r, 0))
    expect(events.at(-1)).toMatchObject({
      taskId: T1,
      state: 'failed',
      stageId: before,
      message: expect.stringContaining('card voltou')
    })
    const reopened = await service.get('p1')
    expect(reopened.ok && reopened.value.cards.find((c) => c.taskId === T1)?.stageId).toBe(before)
    const history = await service.history('p1', T1)
    expect(history.ok && history.value[0]).toMatchObject({
      kind: 'rolled_back',
      detail: { code: 'bad_request' }
    })
  })

  it('mover e voltar antes de sincronizar cancela a escrita', async () => {
    const view = await createBoard()
    notion.offline = true
    await service.move('p1', T1, stageId(view, 'Finalizada'))
    await queue.idle()
    await service.move('p1', T1, stageId(view, 'Revisando'))
    expect((await service.get('p1')).ok).toBe(false) // offline: não carrega, mas o estado local existe
    notion.offline = false
    const view2 = await service.get('p1')
    expect(view2.ok && view2.value.pendingCount).toBe(0)
    clock += 60_000
    queue.kick()
    await queue.idle()
    expect(notion.writes).toEqual([])
  })

  it('Etapa Orkio: criar a propriedade (com confirmação) e escrever a etapa fina', async () => {
    const view = await createBoard({ orkioStage: { mode: 'create' } })
    expect(notion.dataSourceUpdates[0]).toEqual({
      'Etapa Orkio': {
        select: {
          options: [
            { name: 'Prioridades', color: 'gray' },
            { name: 'Em andamento', color: 'blue' },
            { name: 'Revisando', color: 'blue' },
            { name: 'Revisado', color: 'blue' },
            { name: 'Finalizada', color: 'green' }
          ]
        }
      }
    })
    expect(view.config?.orkioStageProperty).toEqual({ id: 'eo-new', name: 'Etapa Orkio' })
    await service.move('p1', T1, stageId(view, 'Revisando'))
    await queue.idle()
    // Status igual (sem escrita de status), só a Etapa Orkio.
    expect(notion.writes.at(-1)).toEqual({
      pageId: T1,
      properties: { 'eo-new': { select: { name: 'Revisando' } } }
    })
  })

  it('Etapa Orkio existente sem as opções: pede confirmação antes de alterar o Notion', async () => {
    const first = await service.get('p1')
    const stages = first.ok
      ? first.value.suggestion!.map((s) => ({
          id: s.id,
          name: s.name,
          notionStatusId: s.notionStatus.id!
        }))
      : []
    const needs = await service.save('p1', {
      ...DEFAULT_INPUT(stages),
      orkioStage: { mode: 'existing', propertyId: 'sel' }
    })
    expect(needs).toMatchObject({ ok: false, error: { code: 'needs_confirmation' } })
    expect(notion.dataSourceUpdates).toEqual([])
    const ok = await service.save('p1', {
      ...DEFAULT_INPUT(stages),
      orkioStage: { mode: 'existing', propertyId: 'sel' },
      addMissingOptions: true
    })
    expect(ok.ok).toBe(true)
    const options = (
      notion.dataSourceUpdates[0]!['sel'] as { select: { options: { name: string }[] } }
    ).select.options
    expect(options.map((o) => o.name)).toEqual([
      'Prioridades',
      'Em andamento',
      'Revisando',
      'Revisado',
      'Finalizada'
    ])
    // Não dá para criar outra "Etapa Orkio" se já existir uma com esse nome.
    notion.properties.push({ id: 'x', name: 'Etapa Orkio', type: 'select', options: [] })
    expect(
      await service.save('p1', { ...DEFAULT_INPUT(stages), orkioStage: { mode: 'create' } })
    ).toMatchObject({
      ok: false
    })
  })

  it('Bloqueada: local por padrão; com checkbox mapeada, escreve e lê do Notion', async () => {
    const view = await createBoard()
    expect(await service.setBlocked('p1', T1, true)).toMatchObject({
      ok: true,
      value: { blocked: true }
    })
    await queue.idle()
    expect(notion.writes).toEqual([])

    await createBoard({ blockedPropertyId: 'blk' })
    await service.get('p1', { force: true })
    await service.setBlocked('p1', T2, true)
    await queue.idle()
    expect(notion.writes.at(-1)).toEqual({ pageId: T2, properties: { blk: { checkbox: true } } })
    // Desmarcado direto no Notion → reflete ao atualizar (depois da janela de espera).
    notion.extras[T2] = { blk: { type: 'checkbox', checked: false } }
    clock += 31_000
    const again = await service.get('p1', { force: true })
    expect(again.ok && again.value.cards.find((c) => c.taskId === T2)?.blocked).toBe(false)
    expect(view.cards).toHaveLength(2)
  })

  it('checkbox inválida para Bloqueada e select inválida para Etapa Orkio são recusadas', async () => {
    const first = await service.get('p1')
    const stages = first.ok
      ? first.value.suggestion!.map((s) => ({
          id: s.id,
          name: s.name,
          notionStatusId: s.notionStatus.id!
        }))
      : []
    expect(
      await service.save('p1', { ...DEFAULT_INPUT(stages), blockedPropertyId: 'sel' })
    ).toMatchObject({
      ok: false
    })
    expect(
      await service.save('p1', {
        ...DEFAULT_INPUT(stages),
        orkioStage: { mode: 'existing', propertyId: 'blk' }
      })
    ).toMatchObject({ ok: false })
  })

  it('status sem etapa → "Sem etapa"; não dá para mover para uma etapa inexistente', async () => {
    notion.status[T2] = 'Backlog'
    const view = await createBoard()
    expect(view.cards.find((c) => c.taskId === T2)?.stageId).toBeNull()
    expect(await service.move('p1', T2, 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'not_found' }
    })
    const moved = await service.move('p1', T2, stageId(view, 'Prioridades'))
    expect(moved).toMatchObject({ ok: true, value: { sync: { state: 'pending' } } })
  })

  it('remover uma etapa: as tarefas dela vão para a primeira etapa compatível', async () => {
    const view = await createBoard()
    await service.move('p1', T1, stageId(view, 'Revisado'))
    const stages = view
      .config!.stages.filter((s) => s.name !== 'Revisado')
      .map((s) => ({ id: s.id, name: s.name, notionStatusId: s.notionStatus.id! }))
    const saved = await service.save('p1', DEFAULT_INPUT(stages))
    expect(saved.ok && saved.value.cards.find((c) => c.taskId === T1)?.stageId).toBe(
      stageId(view, 'Em andamento')
    )
  })

  it('erro desconhecido não vaza detalhes', async () => {
    vi.spyOn(notion, 'statusOptions').mockRejectedValueOnce(new Error('ntn_SECRET'))
    expect(await service.get('p1')).toEqual({
      ok: false,
      error: { code: 'unexpected', message: 'Algo deu errado no quadro. Tente novamente.' }
    })
  })
})

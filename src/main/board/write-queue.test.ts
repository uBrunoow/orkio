import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotionApiError } from '../connectors/notion/notion.client'
import { openDatabase, type Db } from '../db/database'
import { BoardStore, type PendingWrite } from './board.store'
import { NotionWriteQueue, WRITE_MAX_BACKOFF_MS, type WriteQueueDeps } from './write-queue'

const T0 = Date.parse('2026-11-19T12:00:00Z')

describe('NotionWriteQueue', () => {
  let dir: string
  let db: Db
  let store: BoardStore
  let clock: number
  let updatePage: ReturnType<typeof vi.fn<WriteQueueDeps['updatePage']>>
  let events: { kind: string; task: string; code?: string }[]

  function queue(): NotionWriteQueue {
    return new NotionWriteQueue({
      store,
      updatePage,
      now: () => new Date(clock),
      random: () => 0,
      // Sem timers reais: os testes chamam kick() ao avançar o relógio.
      schedule: () => ({ cancel: () => {} }),
      onSynced: (w) => events.push({ kind: 'synced', task: w.taskPageId }),
      onRejected: (w, e) => events.push({ kind: 'rejected', task: w.taskPageId, code: e.code }),
      onRetry: (w, e) => events.push({ kind: 'retry', task: w.taskPageId, code: e.code })
    })
  }

  function enqueue(task: string, status: string, rollbackStage = 'and'): void {
    store.upsertPending({
      taskPageId: task,
      projectId: 'p',
      properties: { st: { status: { name: status } } },
      rollback: { stageId: rollbackStage, blocked: false },
      now: new Date(clock).toISOString()
    })
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-queue-'))
    db = openDatabase(join(dir, 'orkio.db'))
    store = new BoardStore(db)
    clock = T0
    updatePage = vi.fn(async () => {})
    events = []
  })
  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('envia e remove a pendência', async () => {
    enqueue('t1', 'Finalizadas')
    const q = queue()
    q.start()
    await q.idle()
    expect(updatePage).toHaveBeenCalledWith('t1', { st: { status: { name: 'Finalizadas' } } })
    expect(store.allPending()).toEqual([])
    expect(events).toEqual([{ kind: 'synced', task: 't1' }])
  })

  it('sem rede: fica pendente com backoff exponencial (1 s, 2 s, 4 s… até 5 min)', async () => {
    updatePage.mockRejectedValue(new NotionApiError('network', 'Sem conexão.'))
    enqueue('t1', 'Finalizadas')
    const q = queue()
    q.start()
    await q.idle()
    const waits: number[] = []
    for (let i = 0; i < 12; i++) {
      const p = store.pending('t1')!
      waits.push(Date.parse(p.nextAttemptAt) - clock)
      clock = Date.parse(p.nextAttemptAt)
      q.kick()
      await q.idle()
    }
    expect(waits.slice(0, 4)).toEqual([1000, 2000, 4000, 8000])
    expect(Math.max(...waits)).toBe(WRITE_MAX_BACKOFF_MS)
    expect(store.pending('t1')).toMatchObject({ attempts: 13, lastErrorCode: 'network' })
    expect(events.every((e) => e.kind === 'retry')).toBe(true)
  })

  it('antes do horário da nova tentativa não reenvia', async () => {
    updatePage.mockRejectedValueOnce(new NotionApiError('server', '503'))
    enqueue('t1', 'Finalizadas')
    const q = queue()
    q.start()
    await q.idle()
    q.kick()
    await q.idle()
    expect(updatePage).toHaveBeenCalledTimes(1)
    clock += 1000
    q.kick()
    await q.idle()
    expect(updatePage).toHaveBeenCalledTimes(2)
    expect(store.allPending()).toEqual([])
  })

  it('persistência: pendência sobrevive a fechar e reabrir o app', async () => {
    updatePage.mockRejectedValue(new NotionApiError('network', 'x'))
    enqueue('t1', 'Finalizadas')
    const q1 = queue()
    q1.start()
    await q1.idle()
    q1.stop()
    db.close()

    db = openDatabase(join(dir, 'orkio.db'))
    store = new BoardStore(db)
    expect(store.pending('t1')).toMatchObject({
      attempts: 1,
      properties: { st: { status: { name: 'Finalizadas' } } }
    })
    updatePage.mockReset()
    updatePage.mockResolvedValue(undefined)
    clock += 60_000
    const q2 = queue()
    q2.start()
    await q2.idle()
    expect(updatePage).toHaveBeenCalledTimes(1)
    expect(store.allPending()).toEqual([])
  })

  it('Notion recusa (400/403/404) → rollback, sem nova tentativa', async () => {
    for (const code of ['bad_request', 'forbidden', 'not_found'] as const) {
      updatePage.mockRejectedValueOnce(new NotionApiError(code, 'Recusado.'))
      enqueue(`t-${code}`, 'X', 'stage-antes')
    }
    const rejected: PendingWrite[] = []
    const q = new NotionWriteQueue({
      store,
      updatePage,
      now: () => new Date(clock),
      schedule: () => ({ cancel: () => {} }),
      onSynced: () => {},
      onRetry: () => {},
      onRejected: (w) => rejected.push(w)
    })
    q.start()
    await q.idle()
    expect(rejected.map((w) => [w.taskPageId, w.rollback.stageId])).toEqual([
      ['t-bad_request', 'stage-antes'],
      ['t-forbidden', 'stage-antes'],
      ['t-not_found', 'stage-antes']
    ])
    expect(store.allPending()).toEqual([])
  })

  it('coalescência: a última mudança vence e o rollback é o da primeira', () => {
    enqueue('t1', 'Em andamento', 'prio')
    enqueue('t1', 'Finalizadas', 'and')
    expect(store.allPending()).toHaveLength(1)
    expect(store.pending('t1')).toMatchObject({
      properties: { st: { status: { name: 'Finalizadas' } } },
      rollback: { stageId: 'prio' }
    })
  })

  it('mudança durante o envio: o resultado antigo é ignorado e a versão nova é enviada', async () => {
    enqueue('t1', 'Em andamento')
    let release: () => void = () => {}
    updatePage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const q = queue()
    q.start()
    await Promise.resolve()
    enqueue('t1', 'Finalizadas')
    release()
    await q.idle()
    expect(updatePage).toHaveBeenCalledTimes(2)
    expect(updatePage).toHaveBeenLastCalledWith('t1', { st: { status: { name: 'Finalizadas' } } })
    expect(events.filter((e) => e.kind === 'synced')).toHaveLength(1)
    expect(store.allPending()).toEqual([])
  })

  it('erro desconhecido conta como transitório (não perde a mudança)', async () => {
    updatePage.mockRejectedValueOnce(new Error('boom'))
    enqueue('t1', 'X')
    const q = queue()
    q.start()
    await q.idle()
    expect(store.pending('t1')).toMatchObject({ lastErrorCode: 'unexpected' })
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/database'
import type { TaskEventKind } from '../../shared/task-events'
import { BoardStore, type TaskEventInput } from './board.store'

describe('BoardStore.ruleCounts', () => {
  let dir: string
  let db: Db
  let store: BoardStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-store-'))
    db = openDatabase(join(dir, 'orkio.db'))
    store = new BoardStore(db)
  })
  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  const add = (
    at: string,
    kind: TaskEventKind,
    source: 'manual' | 'automation',
    detail: Record<string, unknown> | null,
    projectId = 'p1'
  ): void =>
    store.addEvent({
      taskPageId: 't1',
      projectId,
      at,
      kind,
      source,
      fromStage: null,
      toStage: 's2',
      detail: detail ?? {}
    } as TaskEventInput)

  it('conta disparos por regra na semana', () => {
    add('2026-11-22T10:00:00.000Z', 'moved', 'automation', { ruleId: 'r1' })
    add('2026-11-23T10:00:00.000Z', 'moved', 'automation', { ruleId: 'r1' })
    add('2026-11-10T10:00:00.000Z', 'moved', 'automation', { ruleId: 'r1' })
    add('2026-11-23T10:00:00.000Z', 'automation', 'automation', {
      ruleId: 'r2',
      outcome: 'skipped'
    })
    add('2026-11-23T10:00:00.000Z', 'moved', 'manual', { ruleId: 'r3' })
    add('2026-11-23T10:00:00.000Z', 'moved', 'automation', { ruleId: 'r1' }, 'p2')
    expect(store.ruleCounts('p1', '2026-11-16T12:00:00.000Z')).toEqual({ r1: 2 })
  })
})

describe('BoardStore: pendência confirmada', () => {
  let dir: string
  let db: Db
  let store: BoardStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-store-'))
    db = openDatabase(join(dir, 'orkio.db'))
    store = new BoardStore(db)
  })
  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('compara pela chave estável, não pela ordem do texto salvo', () => {
    // Pendência gravada com outra ordem de chaves (ex.: versão anterior): antes, o DELETE por
    // texto não casava e a escrita confirmada ficava pendente para sempre.
    db.run(
      `INSERT INTO pending_writes
       (task_page_id, project_id, payload_json, rollback_json, attempts, next_attempt_at, created_at)
       VALUES ('t1', 'p1', ?, '{"stageId":null,"blocked":false}', 0, '2026-01-01', '2026-01-01')`,
      JSON.stringify({ st: { status: { name: 'A' } }, blk: { checkbox: true } })
    )
    const sent = store.pending('t1')!.properties
    expect(
      store.deletePendingIfUnchanged('t1', {
        blk: { type: 'checkbox', checked: true },
        st: { type: 'status', name: 'A' }
      })
    ).toBe(true)
    expect(store.pending('t1')).toBeNull()
    expect(sent).toEqual({
      st: { type: 'status', name: 'A' },
      blk: { type: 'checkbox', checked: true }
    })
  })
})

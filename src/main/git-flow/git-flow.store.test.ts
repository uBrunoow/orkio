import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, openDatabase, type Db } from '../db/database'
import { GitFlowStore } from './git-flow.store'

const T1 = '2026-11-26T10:00:00.000Z'
const T2 = '2026-11-26T11:00:00.000Z'

describe('GitFlowStore', () => {
  let db: Db
  let store: GitFlowStore
  beforeEach(() => {
    db = openDatabase(':memory:')
    store = new GitFlowStore(db)
  })
  afterEach(() => db.close())

  it('merge cria a escrita', () => {
    store.merge({
      taskPageId: 't1',
      projectId: 'p',
      properties: { a: { type: 'url', url: 'https://x.test/1' } },
      now: T1
    })
    expect(store.pending('t1')).toEqual({
      taskPageId: 't1',
      projectId: 'p',
      properties: { a: { type: 'url', url: 'https://x.test/1' } },
      attempts: 0,
      nextAttemptAt: T1,
      lastErrorCode: null,
      createdAt: T1
    })
    expect(store.allPending()).toHaveLength(1)
  })

  it('segundo merge junta as propriedades (a última vence) e zera as tentativas', () => {
    store.merge({
      taskPageId: 't1',
      projectId: 'p',
      properties: { a: { type: 'url', url: 'u1' }, b: { type: 'date', start: '2026-11-01' } },
      now: T1
    })
    store.scheduleRetry('t1', 3, '2026-11-26T12:00:00.000Z', 'network')
    store.merge({
      taskPageId: 't1',
      projectId: 'p',
      properties: { a: { type: 'url', url: 'u2' }, c: { type: 'status', name: 'Feito' } },
      now: T2
    })
    const w = store.pending('t1')!
    expect(w.properties).toEqual({
      a: { type: 'url', url: 'u2' },
      b: { type: 'date', start: '2026-11-01' },
      c: { type: 'status', name: 'Feito' }
    })
    expect(w.attempts).toBe(0)
    expect(w.nextAttemptAt).toBe(T2)
    expect(w.lastErrorCode).toBeNull()
    expect(w.createdAt).toBe(T1)
    expect(store.allPending()).toHaveLength(1)
  })

  it('scheduleRetry guarda tentativas, próximo horário e código', () => {
    store.merge({
      taskPageId: 't1',
      projectId: 'p',
      properties: { a: { type: 'url', url: 'u' } },
      now: T1
    })
    store.scheduleRetry('t1', 2, T2, 'rate_limited')
    expect(store.pending('t1')).toMatchObject({
      attempts: 2,
      nextAttemptAt: T2,
      lastErrorCode: 'rate_limited'
    })
  })

  it('deletePendingIfUnchanged só apaga se for a mesma versão', () => {
    const v1 = { a: { type: 'url', url: 'u1' } } as const
    store.merge({ taskPageId: 't1', projectId: 'p', properties: v1, now: T1 })
    store.merge({
      taskPageId: 't1',
      projectId: 'p',
      properties: { b: { type: 'checkbox', checked: true } },
      now: T2
    })
    expect(store.deletePendingIfUnchanged('t1', v1)).toBe(false)
    expect(store.pending('t1')).not.toBeNull()
    expect(store.deletePendingIfUnchanged('t1', store.pending('t1')!.properties)).toBe(true)
    expect(store.pending('t1')).toBeNull()
    expect(store.deletePendingIfUnchanged('t1', v1)).toBe(false)
  })

  it('deletePending remove', () => {
    store.merge({
      taskPageId: 't1',
      projectId: 'p',
      properties: { a: { type: 'url', url: 'u' } },
      now: T1
    })
    store.deletePending('t1')
    expect(store.allPending()).toEqual([])
  })

  it('clear apaga a fila inteira', () => {
    for (const id of ['t1', 't2']) {
      store.merge({
        taskPageId: id,
        projectId: 'p',
        properties: { a: { type: 'url', url: 'u' } },
        now: T1
      })
    }
    store.clear()
    expect(store.allPending()).toEqual([])
  })

  it('a migração v15 sobe um banco v14', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-gf-'))
    try {
      const file = join(dir, 'orkio.db')
      const old = openDatabase(file, MIGRATIONS.slice(0, 14))
      expect(old.version).toBe(14)
      expect(old.all("SELECT name FROM sqlite_master WHERE name = 'git_flow_writes'")).toEqual([])
      old.close()
      const novo = openDatabase(file)
      expect(novo.version).toBe(15)
      expect(
        novo.all("SELECT name FROM sqlite_master WHERE name = 'git_flow_writes'")
      ).toHaveLength(1)
      novo.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

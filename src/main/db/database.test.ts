import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseVersionError, MIGRATIONS, openDatabase } from './database'

describe('database (node:sqlite)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-db-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('cria o schema atual e grava user_version', () => {
    const db = openDatabase(join(dir, 'orkio.db'))
    expect(db.version).toBe(MIGRATIONS.length)
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((t) => t.name)
    expect(tables).toEqual(expect.arrayContaining(['pending_writes', 'task_events', 'task_state']))
    db.close()
  })

  it('migra de forma incremental e idempotente ao reabrir', () => {
    const file = join(dir, 'orkio.db')
    const v1 = openDatabase(file, MIGRATIONS.slice(0, 1))
    v1.run("INSERT INTO task_state VALUES ('p1', 'proj', 'st', 0, '2026-01-01', 'manual')")
    v1.close()
    const extra = [...MIGRATIONS, 'ALTER TABLE task_state ADD COLUMN note TEXT']
    const v2 = openDatabase(file, extra)
    expect(v2.version).toBe(extra.length)
    expect(
      v2.get<{ stage_id: string; note: null }>('SELECT stage_id, note FROM task_state')
    ).toEqual({
      stage_id: 'st',
      note: null
    })
    v2.close()
    // Reabrir não roda nada de novo.
    expect(openDatabase(file, extra).version).toBe(extra.length)
  })

  it('migração com erro não deixa o banco pela metade', () => {
    const file = join(dir, 'orkio.db')
    openDatabase(file).close()
    expect(() =>
      openDatabase(file, [...MIGRATIONS, 'CREATE TABLE x (a); INSERT INTO nao_existe VALUES (1)'])
    ).toThrow()
    const db = openDatabase(file)
    expect(db.version).toBe(MIGRATIONS.length)
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 'x'")).toEqual([])
  })

  it('banco de versão futura é recusado (não destrói dados)', () => {
    const file = join(dir, 'orkio.db')
    openDatabase(file, [...MIGRATIONS, 'SELECT 1']).close()
    expect(() => openDatabase(file)).toThrow(DatabaseVersionError)
  })

  it('transação desfaz tudo em erro; aninhada participa da externa', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO task_state VALUES ('a', 'p', null, 0, 'x', 'manual')")
        db.transaction(() =>
          db.run("INSERT INTO task_state VALUES ('b', 'p', null, 0, 'x', 'manual')")
        )
        throw new Error('falhou')
      })
    ).toThrow('falhou')
    expect(db.all('SELECT * FROM task_state')).toEqual([])
  })

  it('CHECK de source recusa valores inválidos', () => {
    const db = openDatabase(':memory:')
    expect(() => db.run("INSERT INTO task_state VALUES ('a', 'p', null, 0, 'x', 'hack')")).toThrow()
  })
})

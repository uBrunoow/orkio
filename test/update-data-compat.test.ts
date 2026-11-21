/**
 * 6C: atualizar e voltar de versão não pode estragar dados. Abre os dados como a versão nova os
 * deixaria (config e SQLite com versão futura) e confere que esta versão não reescreve nada, e que
 * dados de uma versão anterior migram ao atualizar.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ORKIO_CONFIG_VERSION, createOrkioConfigStore } from '../src/main/config/orkio-config'
import { DatabaseVersionError, MIGRATIONS, openDatabase } from '../src/main/db/database'
import { ConfigReadOnlyError } from '../src/main/storage/config-store'

describe('dados entre versões (atualização e downgrade)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-compat-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('config de uma versão mais nova: só leitura, nada é reescrito, salvar recusa', async () => {
    const file = join(dir, 'orkio-config.json')
    const future = JSON.stringify({
      schemaVersion: ORKIO_CONFIG_VERSION + 3,
      projects: [{ id: 'p1', name: 'x', campoNovo: true }],
      updates: { channel: 'beta', lastSeenVersion: '9.0.0' },
      algoDoFuturo: { a: 1 }
    })
    await writeFile(file, future)
    const store = createOrkioConfigStore(file)
    const { warning } = await store.load()
    expect(store.readOnly).toBe(true)
    expect(warning).toMatch(/versão mais nova/)
    await expect(
      store.update((c) => ({ ...c, updates: { ...c.updates, channel: 'stable' } }))
    ).rejects.toBeInstanceOf(ConfigReadOnlyError)
    expect(await readFile(file, 'utf8')).toBe(future)
  })

  it('SQLite de uma versão mais nova: recusado sem tocar no arquivo', async () => {
    const file = join(dir, 'orkio.db')
    openDatabase(file, [...MIGRATIONS, 'CREATE TABLE coisa_nova (id INTEGER)']).close()
    const before = await readFile(file)
    expect(() => openDatabase(file)).toThrow(DatabaseVersionError)
    expect((await readFile(file)).equals(before)).toBe(true)
    // E a versão nova continua abrindo o mesmo arquivo normalmente.
    const db = openDatabase(file, [...MIGRATIONS, 'CREATE TABLE coisa_nova (id INTEGER)'])
    expect(db.version).toBe(MIGRATIONS.length + 1)
    db.close()
  })

  it('SQLite de uma versão anterior migra ao atualizar, mantendo os dados', () => {
    const file = join(dir, 'orkio.db')
    const old = openDatabase(file, MIGRATIONS.slice(0, 1))
    old.run(
      `INSERT INTO task_state (task_page_id, project_id, stage_id, updated_at, source) VALUES ('t1', 'p1', 's1', '2026-01-01', 'manual')`
    )
    old.close()
    const db = openDatabase(file)
    expect(db.version).toBe(MIGRATIONS.length)
    expect(
      db.get<{ stage_id: string }>('SELECT stage_id FROM task_state WHERE task_page_id = ?', 't1')
    ).toMatchObject({ stage_id: 's1' })
    db.close()
  })
})

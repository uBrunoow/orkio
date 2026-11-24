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
    v1.run(
      "INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source) VALUES ('p1', 'proj', 'st', 0, '2026-01-01', 'manual')"
    )
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
        db.run(
          "INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source) VALUES ('a', 'p', null, 0, 'x', 'manual')"
        )
        db.transaction(() =>
          db.run(
            "INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source) VALUES ('b', 'p', null, 0, 'x', 'manual')"
          )
        )
        throw new Error('falhou')
      })
    ).toThrow('falhou')
    expect(db.all('SELECT * FROM task_state')).toEqual([])
  })

  it('CHECK de source recusa valores inválidos', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.run(
        "INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source) VALUES ('a', 'p', null, 0, 'x', 'hack')"
      )
    ).toThrow()
  })
})

describe('migração v2 (3B)', () => {
  it('v1 com dados → v2 preserva eventos e garante chave única', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v2-'))
    const file = join(dir, 'orkio.db')
    const v1 = openDatabase(file, MIGRATIONS.slice(0, 1))
    v1.run(
      "INSERT INTO task_events (task_page_id, project_id, at, kind, source) VALUES ('t', 'p', 'x', 'moved', 'manual')"
    )
    v1.run(
      "INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source) VALUES ('t', 'p', 's', 0, 'x', 'manual')"
    )
    v1.close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 2))
    expect(db.version).toBe(2)
    expect(db.get('SELECT event_key, kind FROM task_events')).toEqual({
      event_key: null,
      kind: 'moved'
    })
    expect(
      db.get<{ automation_paused: number }>('SELECT automation_paused FROM task_state')
    ).toEqual({
      automation_paused: 0
    })
    const insert = (key: string | null) =>
      db.run(
        "INSERT INTO task_events (task_page_id, project_id, at, kind, source, event_key) VALUES ('t', 'p', 'x', 'automation', 'automation', ?)",
        key
      )
    insert('pr#1:merged')
    expect(() => insert('pr#1:merged')).toThrow()
    // Eventos sem chave (manuais) continuam livres.
    insert(null)
    insert(null)
    db.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('migração v3 (3C)', () => {
  it('v2 → v3 cria config_events sem perder dados', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v3-'))
    const file = join(dir, 'orkio.db')
    const v2 = openDatabase(file, MIGRATIONS.slice(0, 2))
    v2.run(
      "INSERT INTO task_events (task_page_id, project_id, at, kind, source, event_key) VALUES ('t', 'p', 'x', 'automation', 'automation', 'pr#1:merged')"
    )
    v2.close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 3))
    expect(db.version).toBe(3)
    expect(db.get('SELECT event_key FROM task_events')).toEqual({ event_key: 'pr#1:merged' })
    db.run(
      "INSERT INTO config_events (project_id, at, actor, changes_json) VALUES ('p', 'x', 'ana', '[]')"
    )
    expect(db.all('SELECT actor FROM config_events')).toEqual([{ actor: 'ana' }])
    db.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('migração v4 (4A)', () => {
  it('v3 → v4 cria worktrees, agent_runs e permission_rules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v4-'))
    const file = join(dir, 'orkio.db')
    openDatabase(file, MIGRATIONS.slice(0, 3)).close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 4))
    expect(db.version).toBe(4)
    db.run(
      "INSERT INTO agent_runs (id, task_page_id, project_id, mode, status, started_at) VALUES ('r', 't', 'p', 'prompt', 'running', 'x')"
    )
    expect(() =>
      db.run(
        "INSERT INTO agent_runs (id, task_page_id, project_id, mode, status, started_at) VALUES ('r2', 't', 'p', 'shell', 'running', 'x')"
      )
    ).toThrow()
    db.run("INSERT INTO permission_rules VALUES ('p', 'Bash', 'npm test', 'x')")
    expect(() =>
      db.run("INSERT INTO permission_rules VALUES ('p', 'Bash', 'npm test', 'y')")
    ).toThrow()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('v4 → v5 guarda o texto da execução e cria task_artifacts (caminho + commit únicos)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v5-'))
    const file = join(dir, 'orkio.db')
    const old = openDatabase(file, MIGRATIONS.slice(0, 4))
    old.run(
      "INSERT INTO agent_runs (id, task_page_id, project_id, mode, status, started_at) VALUES ('r', 't', 'p', 'prompt', 'succeeded', 'x')"
    )
    old.close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 5))
    expect(db.version).toBe(5)
    expect(
      db.get<{ input_text: string | null }>("SELECT input_text FROM agent_runs WHERE id = 'r'")
    ).toEqual({ input_text: null })
    const add = (id: string): unknown =>
      db.run(
        `INSERT INTO task_artifacts (id, task_page_id, project_id, path, commit_hash, attached_at) VALUES (?, 't', 'p', 'docs/a.md', 'abc', 'x')`,
        id
      )
    add('a1')
    expect(() => add('a2')).toThrow()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('v5 → v6 cria flow_runs e flow_steps (status validados, passos apagados com o fluxo)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v6-'))
    const file = join(dir, 'orkio.db')
    openDatabase(file, MIGRATIONS.slice(0, 5)).close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 6))
    expect(db.version).toBe(6)
    db.run(
      "INSERT INTO flow_runs (id, task_page_id, project_id, flow_id, flow_json, status, state_json, started_at) VALUES ('fr', 't', 'p', 'f', '{}', 'waiting_gate', '{}', 'x')"
    )
    db.run(
      "INSERT INTO flow_steps (flow_run_id, step_id, status, started_at) VALUES ('fr', 'g', 'waiting', 'x')"
    )
    expect(() =>
      db.run(
        "INSERT INTO flow_runs (id, task_page_id, project_id, flow_id, flow_json, status, state_json, started_at) VALUES ('fr2', 't', 'p', 'f', '{}', 'voando', '{}', 'x')"
      )
    ).toThrow()
    db.run("DELETE FROM flow_runs WHERE id = 'fr'")
    expect(db.all('SELECT * FROM flow_steps')).toEqual([])
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('v6 → v7 cria alva_links (um vínculo por tarefa)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v7-'))
    const file = join(dir, 'orkio.db')
    openDatabase(file, MIGRATIONS.slice(0, 6)).close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 7))
    expect(db.version).toBe(7)
    db.run("INSERT INTO alva_links VALUES ('t', 'p', 'TASK-1', 'x')")
    expect(() => db.run("INSERT INTO alva_links VALUES ('t', 'p', 'TASK-2', 'x')")).toThrow()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('v7 → v8 cria a atribuição/aprovação de agentes e mantém fluxos antigos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v8-'))
    const file = join(dir, 'orkio.db')
    const old = openDatabase(file, MIGRATIONS.slice(0, 7))
    old.run(
      "INSERT INTO flow_runs (id, task_page_id, project_id, flow_id, flow_json, status, state_json, started_at) VALUES ('fr', 't', 'p', 'f', '{}', 'finished', '{}', 'x')"
    )
    old.close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 8))
    expect(db.version).toBe(8)
    expect(
      db.get<{ agent_key: string | null }>("SELECT agent_key FROM flow_runs WHERE id = 'fr'")
    ).toEqual({
      agent_key: null
    })
    db.run("INSERT INTO agent_assignments VALUES ('t', 'p', 'repo:ana', 'x', 'manual')")
    expect(() =>
      db.run("INSERT INTO agent_assignments VALUES ('t2', 'p', 'repo:ana', 'x', 'robô')")
    ).toThrow()
    db.run("INSERT INTO agent_trust VALUES ('p', 'ana', 'h', 'x')")
    expect(() => db.run("INSERT INTO agent_trust VALUES ('p', 'ana', 'h2', 'x')")).toThrow()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('v10 → v11 acrescenta session_cost_total sem mexer nas execuções antigas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkio-db-v11-'))
    const file = join(dir, 'orkio.db')
    const old = openDatabase(file, MIGRATIONS.slice(0, 10))
    old.run(
      "INSERT INTO agent_runs (id, task_page_id, project_id, mode, status, started_at, cost) VALUES ('r', 't', 'p', 'prompt', 'succeeded', 'x', 8.5)"
    )
    old.close()
    const db = openDatabase(file, MIGRATIONS.slice(0, 11))
    expect(db.version).toBe(11)
    expect(
      db.get<{ cost: number; session_cost_total: number | null }>(
        "SELECT cost, session_cost_total FROM agent_runs WHERE id = 'r'"
      )
    ).toEqual({ cost: 8.5, session_cost_total: null })
    db.close()
    await rm(dir, { recursive: true, force: true })
  })
})

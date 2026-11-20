/**
 * Banco local do Orkio (SQLite via `node:sqlite`, embutido no Node do Electron: sem módulo
 * nativo, sem rebuild, nada a mais no empacotamento). Guarda só estado local das tarefas
 * (ids, etapa, eventos, escritas pendentes), nunca conteúdo de páginas do Notion.
 *
 * Esta é a única camada que conhece `node:sqlite`: trocar por better-sqlite3 mexe só aqui.
 * Migrações versionadas por `PRAGMA user_version`, cada uma numa transação.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type SqlValue = SQLInputValue

export interface Db {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number }
  get<T>(sql: string, ...params: SqlValue[]): T | undefined
  all<T>(sql: string, ...params: SqlValue[]): T[]
  transaction<T>(fn: () => T): T
  readonly version: number
  close(): void
}

/** `MIGRATIONS[i]` leva o banco da versão i para i+1. Nunca edite uma já publicada. */
export const MIGRATIONS: readonly string[] = [
  // v1 (Etapa 3A): estado local das tarefas, histórico e escritas pendentes no Notion.
  `
  CREATE TABLE task_state (
    task_page_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    stage_id TEXT,
    blocked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'notion', 'automation'))
  );
  CREATE INDEX task_state_project ON task_state (project_id);

  CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_page_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual', 'notion', 'automation')),
    from_stage TEXT,
    to_stage TEXT,
    detail_json TEXT
  );
  CREATE INDEX task_events_task ON task_events (task_page_id, id);

  CREATE TABLE pending_writes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_page_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    rollback_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error_code TEXT,
    created_at TEXT NOT NULL
  );
  `,
  // v2 (Etapa 3B): idempotência das automações, pausa por tarefa e snapshot dos sinais.
  `
  ALTER TABLE task_events ADD COLUMN event_key TEXT;
  CREATE UNIQUE INDEX task_events_key ON task_events (event_key) WHERE event_key IS NOT NULL;
  ALTER TABLE task_state ADD COLUMN automation_paused INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE signal_snapshots (
    task_page_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX signal_snapshots_project ON signal_snapshots (project_id);
  `,
  // v3 (Etapa 3C): histórico de alterações do fluxo (quem, quando, o quê).
  `
  CREATE TABLE config_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    changes_json TEXT NOT NULL
  );
  CREATE INDEX config_events_project ON config_events (project_id, id);
  `,
  // v4 (Etapa 4A): worktrees por tarefa, execuções do Claude Code e aprovações "sempre neste projeto".
  `
  CREATE TABLE worktrees (
    task_page_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    task_page_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('prompt', 'command')),
    command TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    cost REAL,
    summary TEXT
  );
  CREATE INDEX agent_runs_task ON agent_runs (task_page_id, started_at);
  CREATE TABLE permission_rules (
    project_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    pattern TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, tool, pattern)
  );
  `,
  // v5 (Etapa 4B): texto do prompt/argumentos ("Rodar de novo"; o briefing NÃO é guardado) e
  // artefatos anexados às tarefas (só caminho + commit; o conteúdo fica no git).
  `
  ALTER TABLE agent_runs ADD COLUMN input_text TEXT;
  CREATE TABLE task_artifacts (
    id TEXT PRIMARY KEY,
    task_page_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    run_id TEXT,
    path TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    attached_at TEXT NOT NULL,
    notion_page_id TEXT,
    notion_mode TEXT CHECK (notion_mode IN ('section', 'child_page')),
    published_at TEXT,
    UNIQUE (task_page_id, path, commit_hash)
  );
  CREATE INDEX task_artifacts_task ON task_artifacts (task_page_id, attached_at);
  `
]

export class DatabaseVersionError extends Error {
  constructor() {
    super('Banco local de uma versão mais nova do Orkio.')
    this.name = 'DatabaseVersionError'
  }
}

export function openDatabase(file: string, migrations: readonly string[] = MIGRATIONS): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')

  let depth = 0
  const wrapper: Db = {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => {
      const r = db.prepare(sql).run(...params)
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    },
    get: <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
    transaction<T>(fn: () => T): T {
      // Transações aninhadas viram parte da externa.
      if (depth > 0) return fn()
      depth++
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        depth--
      }
    },
    get version() {
      return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    },
    close: () => db.close()
  }

  const current = wrapper.version
  if (current > migrations.length) {
    db.close()
    throw new DatabaseVersionError()
  }
  for (let v = current; v < migrations.length; v++) {
    wrapper.transaction(() => {
      db.exec(migrations[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
  return wrapper
}

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

/**
 * Acesso ao SQLite do quadro: estado local das tarefas, histórico e escritas pendentes.
 * Só ids, etapas, flags e nomes de opção. Nunca título/conteúdo de páginas.
 */
import type { Db } from '../db/database'

export type StateSource = 'manual' | 'notion' | 'automation'

export interface TaskStateRow {
  taskPageId: string
  projectId: string
  stageId: string | null
  blocked: boolean
  updatedAt: string
  source: StateSource
}

export type TaskEventKind =
  | 'added'
  | 'moved'
  | 'reconciled'
  | 'blocked'
  | 'unblocked'
  | 'sync_ok'
  | 'sync_failed'
  | 'rolled_back'

export interface TaskEventRow {
  id: number
  taskPageId: string
  at: string
  kind: TaskEventKind
  source: StateSource
  fromStage: string | null
  toStage: string | null
  detail: Record<string, unknown> | null
}

/** Valores desejados no Notion (por id de propriedade) e como desfazer localmente. */
export interface PendingWrite {
  id: number
  taskPageId: string
  projectId: string
  properties: Record<string, unknown>
  rollback: { stageId: string | null; blocked: boolean }
  attempts: number
  nextAttemptAt: string
  lastErrorCode: string | null
  createdAt: string
}

interface StateDbRow {
  task_page_id: string
  project_id: string
  stage_id: string | null
  blocked: number
  updated_at: string
  source: StateSource
}

interface PendingDbRow {
  id: number
  task_page_id: string
  project_id: string
  payload_json: string
  rollback_json: string
  attempts: number
  next_attempt_at: string
  last_error_code: string | null
  created_at: string
}

function toPending(row: PendingDbRow): PendingWrite {
  return {
    id: row.id,
    taskPageId: row.task_page_id,
    projectId: row.project_id,
    properties: JSON.parse(row.payload_json) as Record<string, unknown>,
    rollback: JSON.parse(row.rollback_json) as PendingWrite['rollback'],
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at
  }
}

export class BoardStore {
  constructor(readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)
  }

  states(projectId: string): Map<string, TaskStateRow> {
    const rows = this.db.all<StateDbRow>('SELECT * FROM task_state WHERE project_id = ?', projectId)
    return new Map(
      rows.map((r) => [
        r.task_page_id,
        {
          taskPageId: r.task_page_id,
          projectId: r.project_id,
          stageId: r.stage_id,
          blocked: r.blocked === 1,
          updatedAt: r.updated_at,
          source: r.source
        }
      ])
    )
  }

  state(taskPageId: string): TaskStateRow | null {
    const r = this.db.get<StateDbRow>('SELECT * FROM task_state WHERE task_page_id = ?', taskPageId)
    return r
      ? {
          taskPageId: r.task_page_id,
          projectId: r.project_id,
          stageId: r.stage_id,
          blocked: r.blocked === 1,
          updatedAt: r.updated_at,
          source: r.source
        }
      : null
  }

  upsertState(row: TaskStateRow): void {
    this.db.run(
      `INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (task_page_id) DO UPDATE SET
         project_id = excluded.project_id, stage_id = excluded.stage_id,
         blocked = excluded.blocked, updated_at = excluded.updated_at, source = excluded.source`,
      row.taskPageId,
      row.projectId,
      row.stageId,
      row.blocked ? 1 : 0,
      row.updatedAt,
      row.source
    )
  }

  addEvent(event: Omit<TaskEventRow, 'id'> & { projectId: string }): void {
    this.db.run(
      `INSERT INTO task_events (task_page_id, project_id, at, kind, source, from_stage, to_stage, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      event.taskPageId,
      event.projectId,
      event.at,
      event.kind,
      event.source,
      event.fromStage,
      event.toStage,
      event.detail ? JSON.stringify(event.detail) : null
    )
  }

  events(taskPageId: string, limit = 50): TaskEventRow[] {
    return this.db
      .all<{
        id: number
        task_page_id: string
        at: string
        kind: TaskEventKind
        source: StateSource
        from_stage: string | null
        to_stage: string | null
        detail_json: string | null
      }>(
        'SELECT * FROM task_events WHERE task_page_id = ? ORDER BY id DESC LIMIT ?',
        taskPageId,
        limit
      )
      .map((r) => ({
        id: r.id,
        taskPageId: r.task_page_id,
        at: r.at,
        kind: r.kind,
        source: r.source,
        fromStage: r.from_stage,
        toStage: r.to_stage,
        detail: r.detail_json ? (JSON.parse(r.detail_json) as Record<string, unknown>) : null
      }))
  }

  // ---------- Escritas pendentes ----------

  pending(taskPageId: string): PendingWrite | null {
    const row = this.db.get<PendingDbRow>(
      'SELECT * FROM pending_writes WHERE task_page_id = ?',
      taskPageId
    )
    return row ? toPending(row) : null
  }

  pendingForProject(projectId: string): PendingWrite[] {
    return this.db
      .all<PendingDbRow>('SELECT * FROM pending_writes WHERE project_id = ? ORDER BY id', projectId)
      .map(toPending)
  }

  allPending(): PendingWrite[] {
    return this.db.all<PendingDbRow>('SELECT * FROM pending_writes ORDER BY id').map(toPending)
  }

  /**
   * Grava o que precisa chegar ao Notion. Uma por tarefa: a nova substitui as propriedades, mas
   * mantém o `rollback` da primeira (o estado antes de qualquer mudança não sincronizada).
   */
  upsertPending(input: {
    taskPageId: string
    projectId: string
    properties: Record<string, unknown>
    rollback: PendingWrite['rollback']
    now: string
  }): void {
    const existing = this.pending(input.taskPageId)
    if (existing) {
      this.db.run(
        `UPDATE pending_writes SET payload_json = ?, attempts = 0, next_attempt_at = ?,
         last_error_code = NULL WHERE task_page_id = ?`,
        JSON.stringify(input.properties),
        input.now,
        input.taskPageId
      )
      return
    }
    this.db.run(
      `INSERT INTO pending_writes
       (task_page_id, project_id, payload_json, rollback_json, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      input.taskPageId,
      input.projectId,
      JSON.stringify(input.properties),
      JSON.stringify(input.rollback),
      input.now,
      input.now
    )
  }

  deletePending(taskPageId: string): void {
    this.db.run('DELETE FROM pending_writes WHERE task_page_id = ?', taskPageId)
  }

  /** Remove só se ainda for a mesma versão (o usuário pode ter movido de novo durante o envio). */
  deletePendingIfUnchanged(taskPageId: string, payloadJson: string): boolean {
    return (
      this.db.run(
        'DELETE FROM pending_writes WHERE task_page_id = ? AND payload_json = ?',
        taskPageId,
        payloadJson
      ).changes > 0
    )
  }

  scheduleRetry(taskPageId: string, attempts: number, nextAttemptAt: string, code: string): void {
    this.db.run(
      `UPDATE pending_writes SET attempts = ?, next_attempt_at = ?, last_error_code = ?
       WHERE task_page_id = ?`,
      attempts,
      nextAttemptAt,
      code,
      taskPageId
    )
  }
}

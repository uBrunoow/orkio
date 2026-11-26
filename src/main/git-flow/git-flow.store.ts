/**
 * Fila persistida das escritas do Fluxo Git no Notion (`git_flow_writes`, SQLite v15). Separada
 * do quadro (`pending_writes`): aqui não há rollback, e uma escrita nova na mesma tarefa junta as
 * propriedades (a última vence por propriedade) em vez de substituir tudo.
 */
import type { Db } from '../db/database'
import type { QueuedWrite, WriteStore } from '../board/write-queue'
import {
  decodePropertyWrites,
  propertyWritesKey,
  type PropertyWrites
} from '../connectors/notion/notion.schema'

export interface GitFlowWrite extends QueuedWrite {
  projectId: string
  createdAt: string
}

interface GitFlowDbRow {
  task_page_id: string
  project_id: string
  payload_json: string
  attempts: number
  next_attempt_at: string
  last_error_code: string | null
  created_at: string
}

function toWrite(row: GitFlowDbRow): GitFlowWrite {
  return {
    taskPageId: row.task_page_id,
    projectId: row.project_id,
    properties: decodePropertyWrites(JSON.parse(row.payload_json)),
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at
  }
}

export class GitFlowStore implements WriteStore<GitFlowWrite> {
  constructor(private readonly db: Db) {}

  pending(taskPageId: string): GitFlowWrite | null {
    const row = this.db.get<GitFlowDbRow>(
      'SELECT * FROM git_flow_writes WHERE task_page_id = ?',
      taskPageId
    )
    return row ? toWrite(row) : null
  }

  allPending(): GitFlowWrite[] {
    return this.db.all<GitFlowDbRow>('SELECT * FROM git_flow_writes ORDER BY id').map(toWrite)
  }

  /** Uma escrita por tarefa: junta as propriedades e a tenta de novo já (zera as tentativas). */
  merge(input: {
    taskPageId: string
    projectId: string
    properties: PropertyWrites
    now: string
  }): void {
    this.db.transaction(() => {
      const existing = this.pending(input.taskPageId)
      if (existing) {
        this.db.run(
          `UPDATE git_flow_writes SET payload_json = ?, attempts = 0, next_attempt_at = ?,
           last_error_code = NULL WHERE task_page_id = ?`,
          propertyWritesKey({ ...existing.properties, ...input.properties }),
          input.now,
          input.taskPageId
        )
        return
      }
      this.db.run(
        `INSERT INTO git_flow_writes
         (task_page_id, project_id, payload_json, attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        input.taskPageId,
        input.projectId,
        propertyWritesKey(input.properties),
        input.now,
        input.now
      )
    })
  }

  deletePending(taskPageId: string): void {
    this.db.run('DELETE FROM git_flow_writes WHERE task_page_id = ?', taskPageId)
  }

  /** Remove só se ainda for a mesma versão (outra escrita pode ter chegado durante o envio). */
  deletePendingIfUnchanged(taskPageId: string, writes: PropertyWrites): boolean {
    const current = this.pending(taskPageId)
    if (!current || propertyWritesKey(current.properties) !== propertyWritesKey(writes)) {
      return false
    }
    this.deletePending(taskPageId)
    return true
  }

  scheduleRetry(taskPageId: string, attempts: number, nextAttemptAt: string, code: string): void {
    this.db.run(
      `UPDATE git_flow_writes SET attempts = ?, next_attempt_at = ?, last_error_code = ?
       WHERE task_page_id = ?`,
      attempts,
      nextAttemptAt,
      code,
      taskPageId
    )
  }
}

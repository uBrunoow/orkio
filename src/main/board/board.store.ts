/**
 * Acesso ao SQLite do quadro: estado local das tarefas, histórico e escritas pendentes.
 * Só ids, etapas, flags e nomes de opção. Nunca título/conteúdo de páginas.
 */
import type { Db, Tx } from '../db/database'
import type { SqlValue } from '../db/database'
import {
  STAGE_ENTRY_KINDS,
  STAGE_EVENT_KINDS,
  SETTLES_REJECTION_KINDS,
  eventSource,
  isTaskEventKind,
  parseDetailJson,
  parseTaskEvent,
  type NewTaskEvent,
  type TaskEvent,
  type TaskEventKind
} from '../../shared/task-events'
import type { BoardHistoryEntry } from '../../shared/board'
import type { StageEventInput } from '../../shared/overview'
import {
  decodePropertyWrites,
  propertyWritesKey,
  type PropertyWrites
} from '../connectors/notion/notion.schema'

export type StateSource = 'manual' | 'notion' | 'automation'

export interface TaskStateRow {
  taskPageId: string
  projectId: string
  stageId: string | null
  blocked: boolean
  updatedAt: string
  source: StateSource
  /** Automações pausadas nesta tarefa (3B). */
  automationPaused: boolean
}

/** Evento a gravar: o do catálogo (`shared/task-events.ts`) + tarefa, horário e chave. */
export type TaskEventInput = NewTaskEvent & {
  taskPageId: string
  projectId: string
  at: string
  /** Idempotência das automações: única por projeto e tarefa. */
  eventKey?: string | null
}

/** Valores desejados no Notion (por id de propriedade) e como desfazer localmente. */
export interface PendingWrite {
  id: number
  taskPageId: string
  projectId: string
  properties: PropertyWrites
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
  automation_paused: number
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
    properties: decodePropertyWrites(JSON.parse(row.payload_json)),
    rollback: JSON.parse(row.rollback_json) as PendingWrite['rollback'],
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at
  }
}

function toStateRow(r: StateDbRow): TaskStateRow {
  return {
    taskPageId: r.task_page_id,
    projectId: r.project_id,
    stageId: r.stage_id,
    blocked: r.blocked === 1,
    updatedAt: r.updated_at,
    source: r.source,
    automationPaused: r.automation_paused === 1
  }
}

interface EventDbRow {
  id: number
  task_page_id: string
  project_id: string
  at: string
  kind: string
  source: string
  from_stage: string | null
  to_stage: string | null
  detail_json: string | null
}

/** Evento do histórico com o projeto e a tarefa (consultas de todos os projetos). */
export type ProjectHistoryEntry = BoardHistoryEntry & { projectId: string; taskId: string }

/** Leitura sempre pelo catálogo: tipo desconhecido (outra versão) vira `null`. */
function toEvent(r: EventDbRow): TaskEvent | null {
  return parseTaskEvent({
    kind: r.kind,
    source: r.source,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    detail: parseDetailJson(r.detail_json)
  })
}

function toHistoryEntry(r: EventDbRow): ProjectHistoryEntry | null {
  const event = toEvent(r)
  return event
    ? { id: r.id, at: r.at, projectId: r.project_id, taskId: r.task_page_id, ...event }
    : null
}

export class BoardStore {
  constructor(readonly db: Db) {}

  transaction<T>(fn: (tx: Tx) => T): T {
    return this.db.transaction(fn)
  }

  states(projectId: string): Map<string, TaskStateRow> {
    const rows = this.db.all<StateDbRow>('SELECT * FROM task_state WHERE project_id = ?', projectId)
    return new Map(rows.map((r) => [r.task_page_id, toStateRow(r)]))
  }

  state(taskPageId: string): TaskStateRow | null {
    const r = this.db.get<StateDbRow>('SELECT * FROM task_state WHERE task_page_id = ?', taskPageId)
    return r ? toStateRow(r) : null
  }

  upsertState(row: Omit<TaskStateRow, 'automationPaused'>): void {
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

  addEvent(event: TaskEventInput): void {
    const detail = event.detail as Record<string, unknown>
    this.db.run(
      `INSERT INTO task_events (task_page_id, project_id, at, kind, source, from_stage, to_stage, detail_json, event_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.taskPageId,
      event.projectId,
      event.at,
      event.kind,
      eventSource(event),
      event.fromStage ?? null,
      event.toStage ?? null,
      Object.keys(detail).length > 0 ? JSON.stringify(detail) : null,
      event.eventKey ?? null
    )
  }

  /** Movimentos feitos por cada automação desde `sinceIso` (disparos da semana). */
  ruleCounts(projectId: string, sinceIso: string): Record<string, number> {
    const out: Record<string, number> = {}
    for (const r of this.db.all<{ rule_id: string | null; n: number }>(
      `SELECT json_extract(detail_json, '$.ruleId') AS rule_id, COUNT(*) AS n FROM task_events
       WHERE project_id = ? AND source = 'automation' AND kind = 'moved' AND at >= ?
       GROUP BY rule_id`,
      projectId,
      sinceIso
    )) {
      if (r.rule_id) out[r.rule_id] = r.n
    }
    return out
  }

  /**
   * Esta chave de evento (idempotência das automações) já foi processada nesta tarefa? A chave só
   * vale dentro do projeto e da tarefa: a PR #12 de outro projeto, ou a mesma PR em outra tarefa,
   * é outro evento.
   */
  hasEventKey(projectId: string, taskPageId: string, key: string): boolean {
    return (
      this.db.get(
        'SELECT 1 AS x FROM task_events WHERE project_id = ? AND task_page_id = ? AND event_key = ?',
        projectId,
        taskPageId,
        key
      ) !== undefined
    )
  }

  /** Último movimento manual da tarefa (para conflito com eventos mais antigos). */
  lastManualMoveAt(taskPageId: string): string | null {
    return (
      this.db.get<{ at: string }>(
        `SELECT at FROM task_events WHERE task_page_id = ? AND source = 'manual' AND kind = 'moved'
         ORDER BY id DESC LIMIT 1`,
        taskPageId
      )?.at ?? null
    )
  }

  setAutomationPaused(taskPageId: string, projectId: string, paused: boolean, at: string): void {
    this.db.run(
      `INSERT INTO task_state (task_page_id, project_id, stage_id, blocked, updated_at, source, automation_paused)
       VALUES (?, ?, NULL, 0, ?, 'manual', ?)
       ON CONFLICT (task_page_id) DO UPDATE SET automation_paused = excluded.automation_paused`,
      taskPageId,
      projectId,
      at,
      paused ? 1 : 0
    )
  }

  // ---------- Fluxo (3C) ----------

  /** Tarefas por etapa (estado local). */
  taskCounts(projectId: string): Record<string, number> {
    const rows = this.db.all<{ stage_id: string | null; n: number }>(
      'SELECT stage_id, COUNT(*) AS n FROM task_state WHERE project_id = ? GROUP BY stage_id',
      projectId
    )
    return Object.fromEntries(rows.filter((r) => r.stage_id).map((r) => [r.stage_id!, r.n]))
  }

  tasksInStage(projectId: string, stageId: string): string[] {
    return this.db
      .all<{ task_page_id: string }>(
        'SELECT task_page_id FROM task_state WHERE project_id = ? AND stage_id = ?',
        projectId,
        stageId
      )
      .map((r) => r.task_page_id)
  }

  addConfigEvent(projectId: string, at: string, actor: string, changes: string[]): void {
    this.db.run(
      'INSERT INTO config_events (project_id, at, actor, changes_json) VALUES (?, ?, ?, ?)',
      projectId,
      at,
      actor,
      JSON.stringify(changes)
    )
  }

  configEvents(
    projectId: string,
    limit = 30
  ): { id: number; at: string; actor: string; changes: string[] }[] {
    return this.db
      .all<{ id: number; at: string; actor: string; changes_json: string }>(
        'SELECT id, at, actor, changes_json FROM config_events WHERE project_id = ? ORDER BY id DESC LIMIT ?',
        projectId,
        limit
      )
      .map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        changes: JSON.parse(r.changes_json) as string[]
      }))
  }

  // ---------- Snapshots dos sinais (3B) ----------

  snapshots(projectId: string): Map<string, unknown> {
    return new Map(
      this.db
        .all<{ task_page_id: string; snapshot_json: string }>(
          'SELECT task_page_id, snapshot_json FROM signal_snapshots WHERE project_id = ?',
          projectId
        )
        .map((r) => [r.task_page_id, JSON.parse(r.snapshot_json) as unknown])
    )
  }

  saveSnapshot(taskPageId: string, projectId: string, snapshot: unknown, at: string): void {
    this.db.run(
      `INSERT INTO signal_snapshots (task_page_id, project_id, snapshot_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (task_page_id) DO UPDATE SET
         project_id = excluded.project_id, snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at`,
      taskPageId,
      projectId,
      JSON.stringify(snapshot),
      at
    )
  }

  /** Histórico da tarefa, mais novo primeiro. Linhas de tipo desconhecido ficam de fora. */
  events(taskPageId: string, limit = 50): BoardHistoryEntry[] {
    return this.db
      .all<EventDbRow>(
        'SELECT * FROM task_events WHERE task_page_id = ? ORDER BY id DESC LIMIT ?',
        taskPageId,
        limit
      )
      .flatMap((r) => {
        const event = toEvent(r)
        return event ? [{ id: r.id, at: r.at, ...event }] : []
      })
  }

  // ---------- Consultas da visão geral, do orquestrador e do diagnóstico ----------

  /**
   * Eventos de todos os projetos desde `since`, mais novos primeiro (atividade). `group` só
   * estreita a busca: `board` sem os movimentos das automações, `automation` só o que elas fizeram.
   * Quem chama ainda confere o grupo do evento (`activityGroup`). Linha de tipo desconhecido vem
   * como `null` (conta para a paginação).
   */
  recentEvents(query: {
    since: string
    kinds: readonly TaskEventKind[]
    projectId?: string | undefined
    beforeId?: number | undefined
    group?: 'board' | 'automation' | undefined
    limit: number
  }): (ProjectHistoryEntry | null)[] {
    const where: string[] = ['at >= ?']
    const params: SqlValue[] = [query.since]
    if (query.projectId) {
      where.push('project_id = ?')
      params.push(query.projectId)
    }
    if (query.beforeId) {
      where.push('id < ?')
      params.push(query.beforeId)
    }
    where.push(`kind IN (${query.kinds.map(() => '?').join(', ')})`)
    params.push(...query.kinds)
    if (query.group === 'board') where.push(`NOT (kind = 'moved' AND source = 'automation')`)
    if (query.group === 'automation') where.push(`(kind = 'automation' OR source = 'automation')`)
    return this.db
      .all<EventDbRow>(
        `SELECT * FROM task_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
        ...params,
        query.limit
      )
      .map(toHistoryEntry)
  }

  /** Recusas do Notion desde `since` sem nova mudança da tarefa depois (mover de novo resolve). */
  unsettledRejections(since: string): ProjectHistoryEntry[] {
    return this.db
      .all<EventDbRow>(
        `SELECT * FROM task_events e WHERE kind = 'rolled_back' AND at >= ?
         AND NOT EXISTS (SELECT 1 FROM task_events l WHERE l.task_page_id = e.task_page_id
           AND l.id > e.id AND l.kind IN (${SETTLES_REJECTION_KINDS.map(() => '?').join(', ')}))`,
        since,
        ...SETTLES_REJECTION_KINDS
      )
      .flatMap((r) => {
        const e = toHistoryEntry(r)
        return e ? [e] : []
      })
  }

  /** Mudanças de etapa desde `from`, em ordem (semana: finalizadas e tempo na etapa). */
  stageEvents(from: string): StageEventInput[] {
    return this.db
      .all<EventDbRow>(
        `SELECT * FROM task_events
         WHERE at >= ? AND kind IN (${STAGE_EVENT_KINDS.map(() => '?').join(', ')}) ORDER BY id`,
        from,
        ...STAGE_EVENT_KINDS
      )
      .flatMap((e): StageEventInput[] =>
        isTaskEventKind(e.kind)
          ? [
              {
                id: e.id,
                taskPageId: e.task_page_id,
                projectId: e.project_id,
                at: e.at,
                kind: e.kind,
                fromStage: e.from_stage,
                toStage: e.to_stage
              }
            ]
          : []
      )
  }

  /** Última entrada da tarefa nesta etapa (movida, reconciliada ou criada nela). */
  lastEntryAt(taskPageId: string, stageId: string): string | null {
    return (
      this.db.get<{ at: string | null }>(
        `SELECT MAX(at) AS at FROM task_events WHERE task_page_id = ? AND to_stage = ?
         AND kind IN (${STAGE_ENTRY_KINDS.map(() => '?').join(', ')})`,
        taskPageId,
        stageId,
        ...STAGE_ENTRY_KINDS
      )?.at ?? null
    )
  }

  /** Estado local de todas as tarefas (cartões dos projetos). */
  allStates(): TaskStateRow[] {
    return this.db.all<StateDbRow>('SELECT * FROM task_state').map(toStateRow)
  }

  /** Escritas que falharam pelo menos `minAttempts` vezes (presas tentando de novo). */
  stuckWrites(minAttempts: number): PendingWrite[] {
    return this.db
      .all<PendingDbRow>(
        `SELECT * FROM pending_writes WHERE last_error_code IS NOT NULL AND attempts >= ?
         ORDER BY id`,
        minAttempts
      )
      .map(toPending)
  }

  /** Contagens do diagnóstico. */
  counts(): { events: number; pendingWrites: number } {
    const n = (sql: string): number => this.db.get<{ n: number }>(sql)?.n ?? 0
    return {
      events: n('SELECT COUNT(*) AS n FROM task_events'),
      pendingWrites: n('SELECT COUNT(*) AS n FROM pending_writes')
    }
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
    properties: PropertyWrites
    rollback: PendingWrite['rollback']
    now: string
  }): void {
    const existing = this.pending(input.taskPageId)
    if (existing) {
      this.db.run(
        `UPDATE pending_writes SET payload_json = ?, attempts = 0, next_attempt_at = ?,
         last_error_code = NULL WHERE task_page_id = ?`,
        propertyWritesKey(input.properties),
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
      propertyWritesKey(input.properties),
      JSON.stringify(input.rollback),
      input.now,
      input.now
    )
  }

  deletePending(taskPageId: string): void {
    this.db.run('DELETE FROM pending_writes WHERE task_page_id = ?', taskPageId)
  }

  /**
   * Remove só se ainda for a mesma versão (o usuário pode ter movido de novo durante o envio).
   * Compara pela chave estável (`propertyWritesKey`), não pelo texto salvo.
   */
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
      `UPDATE pending_writes SET attempts = ?, next_attempt_at = ?, last_error_code = ?
       WHERE task_page_id = ?`,
      attempts,
      nextAttemptAt,
      code,
      taskPageId
    )
  }
}

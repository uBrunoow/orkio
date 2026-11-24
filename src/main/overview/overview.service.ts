/**
 * Visão geral (Etapa 6D): junta, de todos os projetos, o que já está no app (SQLite, execuções e
 * perguntas em memória, fluxos, cache de sinais e o cache em memória das tarefas do Notion).
 * Nunca chama APIs: "Atualizar" pede o ciclo das automações (3B), que relê git/GitHub/Notion.
 */
import {
  ACTIVITY_KINDS,
  NOTION_PENDING_ATTEMPTS,
  NOTION_REJECT_WINDOW_MS,
  STAGE_EVENT_KINDS,
  WEEK_MS,
  activityGroup,
  activitySection,
  buildRunning,
  costSum,
  finalStageId,
  finishedCount,
  flowWaitingItem,
  notionWaitingItem,
  prAttention,
  projectCard,
  pullsInWeek,
  requestWaitingItem,
  reviewStageId,
  sortWaiting,
  stageDwell,
  type ActivityPage,
  type ActivityQuery,
  type OverviewSnapshot,
  type OverviewTask,
  type PendingRequest,
  type StageEventInput,
  type WaitingItem
} from '../../shared/overview'
import type { FlowRunView } from '../../shared/task-flow'
import type { PullRequestSummary, TaskSignals } from '../../shared/task-signals'
import { describeEvent, branchUrl, prUrl } from '../../shared/task-history'
import type { RunStatus } from '../../shared/agent-run'
import type { OrkioConfig } from '../config/orkio-config'
import type { Db, SqlValue } from '../db/database'
import type { NotionTask, NotionWorkspaceStatus } from '../../shared/notion'
import type { ProjectView } from '../../shared/projects'

export interface OverviewDeps {
  db: Db
  config(): OrkioConfig
  /** Lista local dos projetos (sem GitHub). */
  projects(): Promise<ProjectView[]>
  /** Fluxos ativos (5A). */
  flows(): FlowRunView[]
  /** Perguntas e permissões em memória (4A). */
  requests(): (PendingRequest & { projectId: string; taskId: string })[]
  /** Execuções na fila ou rodando (4A). */
  runs(): { runId: string; projectId: string; taskId: string; status: RunStatus }[]
  /** Tarefas em memória (mesmo vencidas), sem rede. */
  cachedTasks(projectId: string): NotionTask[] | null
  notionHealth(): NotionWorkspaceStatus['health'] | null
  /** Último resultado dos sinais (2D) e PRs do repositório, sem rede. */
  signals(projectId: string): Record<string, TaskSignals> | null
  pulls(projectId: string): PullRequestSummary[] | null
  /** Ciclo das automações agora (git + GitHub + Notion), como o "Atualizar" do quadro. */
  refresh(projectId: string): Promise<void>
  /** Algo mudou: total de "Esperando você" (badge) e aviso ao renderer. */
  changed(waiting: number): void
  now?: () => Date
  debounceMs?: number
}

interface EventRow {
  id: number
  task_page_id: string
  project_id: string
  at: string
  kind: string
  source: 'manual' | 'notion' | 'automation'
  from_stage: string | null
  to_stage: string | null
  detail_json: string | null
}

const DISPLAY_ID_IN_BRANCH = /(?:^|\/)([A-Za-z][A-Za-z0-9]*-\d+)(?=\/|-|$)/

export class OverviewService {
  /** Último ID/título conhecido de cada tarefa (só memória; sobrevive a invalidações do cache). */
  private readonly known = new Map<string, { displayId: string | null; title: string | null }>()
  private timer: NodeJS.Timeout | null = null
  private lastCount = -1

  constructor(private readonly deps: OverviewDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  // ---------- Leitura ----------

  async snapshot(): Promise<OverviewSnapshot> {
    const config = this.deps.config()
    const now = this.now()
    const resolve = this.resolver(config)
    const waiting = this.waitingItems(config, resolve)
    const flows = this.deps.flows().filter((f) => this.hasProject(config, f.projectId))

    const runRows = this.deps.runs().filter((r) => this.hasProject(config, r.projectId))
    const runInfo = this.runInfo(runRows.map((r) => r.runId))
    const running = buildRunning(
      runRows.map((r) => ({
        runId: r.runId,
        projectId: r.projectId,
        taskId: r.taskId,
        state: r.status === 'queued' ? 'queued' : 'running',
        startedAt: runInfo.get(r.runId)?.started_at ?? now.toISOString(),
        command: runInfo.get(r.runId)?.command ?? null
      })),
      flows,
      resolve
    )

    const notices: string[] = []
    const prs = config.projects.flatMap((p) => {
      const signals = this.deps.signals(p.id)
      if (!signals) return []
      return prAttention(signals, (taskId) => resolve(p.id, taskId), now)
    })
    if (config.projects.some((p) => p.notionProject && p.repo && !this.deps.signals(p.id))) {
      notices.push('Branches e PRs aparecem depois da primeira verificação do GitHub (até 1 min).')
    }

    const views = await this.deps.projects().catch(() => [] as ProjectView[])
    const notionHealth = this.deps.notionHealth()
    const states = this.deps.db.all<{
      project_id: string
      stage_id: string | null
      blocked: number
      automation_paused: number
    }>('SELECT project_id, stage_id, blocked, automation_paused FROM task_state')
    const projects = views.map((view) =>
      projectCard({
        project: view,
        stages: config.boards[view.id]?.stages ?? null,
        states: states
          .filter((s) => s.project_id === view.id)
          .map((s) => ({
            stageId: s.stage_id,
            blocked: s.blocked === 1,
            automationPaused: s.automation_paused === 1
          })),
        notionHealth,
        automationsPaused: config.automation.paused,
        waiting: waiting.filter((w) => w.task.projectId === view.id).length
      })
    )

    return {
      generatedAt: now.toISOString(),
      waiting,
      running,
      prs,
      projects,
      week: this.week(config, now),
      notices
    }
  }

  /** Só "Esperando você" (badge e menu): barato, sem a lista de projetos. */
  waiting(): WaitingItem[] {
    const config = this.deps.config()
    return this.waitingItems(config, this.resolver(config))
  }

  activity(query: ActivityQuery = {}): ActivityPage {
    const config = this.deps.config()
    const resolve = this.resolver(config)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const where: string[] = ['at >= ?']
    const params: SqlValue[] = [new Date(this.now().getTime() - WEEK_MS).toISOString()]
    if (query.projectId) {
      where.push('project_id = ?')
      params.push(query.projectId)
    }
    if (query.beforeId) {
      where.push('id < ?')
      params.push(query.beforeId)
    }
    const kinds = query.group
      ? ACTIVITY_KINDS[query.group]
      : [...new Set(Object.values(ACTIVITY_KINDS).flat())]
    where.push(`kind IN (${kinds.map(() => '?').join(', ')})`)
    params.push(...kinds)
    if (query.group === 'board') where.push(`NOT (kind = 'moved' AND source = 'automation')`)
    if (query.group === 'automation') where.push(`(kind = 'automation' OR source = 'automation')`)

    // Lê um pouco a mais: alguns eventos (automação sem efeito) ficam de fora.
    const rows = this.deps.db.all<EventRow>(
      `SELECT * FROM task_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      ...params,
      limit * 2 + 1
    )
    const items: ActivityPage['items'] = []
    let consumed = 0
    for (const row of rows) {
      if (items.length >= limit) break
      consumed++
      if (!this.hasProject(config, row.project_id)) continue
      const detail = row.detail_json
        ? (JSON.parse(row.detail_json) as Record<string, unknown>)
        : null
      const event = {
        kind: row.kind,
        source: row.source,
        fromStage: row.from_stage,
        toStage: row.to_stage,
        detail
      }
      const group = activityGroup(event)
      if (!group || (query.group && group !== query.group)) continue
      const stages = config.boards[row.project_id]?.stages ?? []
      const stageName = (id: string | null): string =>
        id ? (stages.find((s) => s.id === id)?.name ?? 'etapa removida') : 'Sem etapa'
      items.push({
        id: row.id,
        at: row.at,
        group,
        task: resolve(row.project_id, row.task_page_id),
        text: describeEvent(event, stageName),
        link: prUrl(event) ?? branchUrl(event),
        section: activitySection(group)
      })
    }
    return { items, hasMore: rows.length > consumed || rows.length > limit * 2 }
  }

  /** "Atualizar": ciclo das automações de cada projeto com quadro e vínculo (em paralelo). */
  async refresh(): Promise<OverviewSnapshot> {
    const config = this.deps.config()
    const ids = config.projects
      .filter((p) => p.notionProject && config.boards[p.id])
      .map((p) => p.id)
    await Promise.all(ids.map((id) => this.deps.refresh(id).catch(() => undefined)))
    return this.snapshot()
  }

  // ---------- Mudanças ----------

  /** Algo relevante mudou: recalcula o total (com debounce) e avisa. */
  touch(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      let count: number
      try {
        count = this.waiting().length
      } catch {
        count = Math.max(this.lastCount, 0)
      }
      this.lastCount = count
      this.deps.changed(count)
    }, this.deps.debounceMs ?? 300)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  // ---------- Auxiliares ----------

  private hasProject(config: OrkioConfig, projectId: string): boolean {
    return config.projects.some((p) => p.id === projectId)
  }

  private waitingItems(
    config: OrkioConfig,
    resolve: (projectId: string, taskId: string) => OverviewTask
  ): WaitingItem[] {
    const items: WaitingItem[] = []
    for (const flow of this.deps.flows()) {
      if (!this.hasProject(config, flow.projectId)) continue
      const item = flowWaitingItem(flow, resolve(flow.projectId, flow.taskId))
      if (item) items.push(item)
    }
    for (const req of this.deps.requests()) {
      if (!this.hasProject(config, req.projectId)) continue
      items.push(requestWaitingItem(req, resolve(req.projectId, req.taskId)))
    }
    const since = new Date(this.now().getTime() - NOTION_REJECT_WINDOW_MS).toISOString()
    // Recusa do Notion ainda sem nova mudança na tarefa (mover de novo resolve).
    for (const r of this.deps.db.all<EventRow>(
      `SELECT * FROM task_events e WHERE kind = 'rolled_back' AND at >= ?
         AND NOT EXISTS (SELECT 1 FROM task_events l WHERE l.task_page_id = e.task_page_id
           AND l.id > e.id AND l.kind IN ('moved', 'reconciled', 'sync_ok'))`,
      since
    )) {
      if (!this.hasProject(config, r.project_id)) continue
      const detail = r.detail_json ? (JSON.parse(r.detail_json) as Record<string, unknown>) : null
      items.push(
        notionWaitingItem(
          {
            type: 'rejected',
            eventId: r.id,
            code: typeof detail?.['code'] === 'string' ? detail['code'] : null,
            at: r.at
          },
          resolve(r.project_id, r.task_page_id)
        )
      )
    }
    for (const w of this.deps.db.all<{
      id: number
      task_page_id: string
      project_id: string
      attempts: number
      created_at: string
    }>(
      `SELECT id, task_page_id, project_id, attempts, created_at FROM pending_writes
       WHERE last_error_code IS NOT NULL AND attempts >= ?`,
      NOTION_PENDING_ATTEMPTS
    )) {
      if (!this.hasProject(config, w.project_id)) continue
      items.push(
        notionWaitingItem(
          { type: 'retrying', writeId: w.id, attempts: w.attempts, since: w.created_at },
          resolve(w.project_id, w.task_page_id)
        )
      )
    }
    return sortWaiting(items)
  }

  /** ID e título: cache em memória do Notion → último conhecido → ID pela branch do worktree. */
  private resolver(config: OrkioConfig): (projectId: string, taskId: string) => OverviewTask {
    const byProject = new Map<string, Map<string, NotionTask> | null>()
    return (projectId, taskId) => {
      if (!byProject.has(projectId)) {
        const tasks = this.deps.cachedTasks(projectId)
        byProject.set(projectId, tasks ? new Map(tasks.map((t) => [t.id, t])) : null)
      }
      const cached = byProject.get(projectId)?.get(taskId)
      if (cached) this.known.set(taskId, { displayId: cached.displayId, title: cached.title })
      let info = this.known.get(taskId) ?? null
      if (!info) {
        const branch = this.deps.db.get<{ branch: string }>(
          'SELECT branch FROM worktrees WHERE task_page_id = ?',
          taskId
        )?.branch
        // `ORK-2/slug` (antigo) ou `feat/ORK-2-slug` (novo); sem ID no nome, fica sem ID.
        const id = branch ? DISPLAY_ID_IN_BRANCH.exec(branch)?.[1] : undefined
        info = { displayId: id ? id.toUpperCase() : null, title: null }
      }
      return {
        projectId,
        projectName: config.projects.find((p) => p.id === projectId)?.name ?? 'Projeto removido',
        taskId,
        displayId: info.displayId,
        title: info.title
      }
    }
  }

  private runInfo(ids: string[]): Map<string, { started_at: string; command: string | null }> {
    if (ids.length === 0) return new Map()
    const rows = this.deps.db.all<{ id: string; started_at: string; command: string | null }>(
      `SELECT id, started_at, command FROM agent_runs WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids
    )
    return new Map(rows.map((r) => [r.id, r]))
  }

  private week(config: OrkioConfig, now: Date): OverviewSnapshot['week'] {
    const since = new Date(now.getTime() - WEEK_MS).toISOString()
    // Entradas em "Revisado" podem ser anteriores à semana: lê 60 dias de movimentos.
    const from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()
    const events = this.deps.db
      .all<EventRow>(
        `SELECT id, task_page_id, project_id, at, kind, from_stage, to_stage FROM task_events
         WHERE at >= ? AND kind IN (${STAGE_EVENT_KINDS.map(() => '?').join(', ')}) ORDER BY id`,
        from,
        ...STAGE_EVENT_KINDS
      )
      .filter((e) => this.hasProject(config, e.project_id))
      .map((e): StageEventInput => ({
        id: e.id,
        taskPageId: e.task_page_id,
        projectId: e.project_id,
        at: e.at,
        kind: e.kind,
        fromStage: e.from_stage,
        toStage: e.to_stage
      }))
    const finals = new Map<string, string>()
    const reviews = new Map<string, string>()
    for (const [projectId, board] of Object.entries(config.boards)) {
      const last = finalStageId(board.stages)
      if (last) finals.set(projectId, last)
      const review = reviewStageId(board.stages)
      if (review) reviews.set(projectId, review)
    }
    const dwell = stageDwell(events, reviews, since)
    const pulls = pullsInWeek(
      config.projects.filter((p) => p.repo).map((p) => this.deps.pulls(p.id)),
      since
    )
    const runs = this.deps.db.all<{ cost: number | null }>(
      `SELECT cost FROM agent_runs WHERE started_at >= ? AND status IN ('succeeded', 'failed', 'cancelled')`,
      since
    )
    return {
      since,
      finished: finishedCount(events, finals, since),
      prsOpened: pulls.opened,
      prsMerged: pulls.merged,
      cost: costSum(runs),
      reviewAvgMs: dwell.avgMs,
      reviewSamples: dwell.samples
    }
  }
}

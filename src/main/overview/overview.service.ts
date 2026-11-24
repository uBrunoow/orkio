/**
 * Visão geral (Etapa 6D): junta, de todos os projetos, o que já está no app (SQLite, execuções e
 * perguntas em memória, fluxos, cache de sinais e o cache em memória das tarefas do Notion).
 * Nunca chama APIs: "Atualizar" pede o ciclo das automações (3B), que relê git/GitHub/Notion.
 */
import {
  NOTION_PENDING_ATTEMPTS,
  NOTION_REJECT_WINDOW_MS,
  WEEK_MS,
  activitySection,
  buildRunning,
  costSum,
  finishedCount,
  flowWaitingItem,
  notionWaitingItem,
  prAttention,
  projectCard,
  pullsInWeek,
  requestWaitingItem,
  sortWaiting,
  stageDwell,
  type ActivityPage,
  type ActivityQuery,
  type OverviewSnapshot,
  type OverviewTask,
  type PendingRequest,
  type WaitingItem
} from '../../shared/overview'
import type { FlowRunView } from '../../shared/task-flow'
import { stageWithRole } from '../../shared/board'
import type { PullRequestSummary, TaskSignals } from '../../shared/task-signals'
import { describeEvent, branchUrl, prUrl } from '../../shared/task-history'
import { ACTIVITY_KINDS, activityGroup } from '../../shared/task-events'
import { displayIdInBranch } from '../../shared/task-id-match'
import type { RunStatus } from '../../shared/agent-run'
import type { OrkioConfig } from '../config/orkio-config'
import type { BoardStore } from '../board/board.store'
import type { RunService } from '../claude/run.service'
import type { NotionTask, NotionWorkspaceStatus } from '../../shared/notion'
import type { ProjectView } from '../../shared/projects'
import { automationProjectIds } from '../config/queries'

export interface OverviewDeps {
  /** Leituras do quadro (dono de `task_state`, `task_events`, `pending_writes`). */
  board: Pick<
    BoardStore,
    'allStates' | 'recentEvents' | 'unsettledRejections' | 'stuckWrites' | 'stageEvents'
  >
  /** Leituras das execuções do Claude Code (dono de `agent_runs`: `RunService`). */
  runStore: Pick<RunService, 'startInfo' | 'costsSince'>
  /** Branch do worktree da tarefa (dono de `worktrees`: `WorktreeService`), sem rede. */
  worktreeBranch(taskId: string): string | null
  config(): OrkioConfig
  /** Lista local dos projetos (sem GitHub). */
  projects(): Promise<ProjectView[]>
  flows(): FlowRunView[]
  /** Perguntas e permissões em memória (4A). */
  requests(): (PendingRequest & { projectId: string; taskId: string })[]
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

/** Entradas numa etapa podem ser anteriores à semana: o tempo na etapa lê 60 dias. */
const DWELL_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000

export class OverviewService {
  /** Último ID/título conhecido de cada tarefa (só memória; sobrevive a invalidações do cache). */
  private readonly known = new Map<string, { displayId: string | null; title: string | null }>()
  private timer: NodeJS.Timeout | null = null
  private lastCount = -1

  constructor(private readonly deps: OverviewDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  async snapshot(): Promise<OverviewSnapshot> {
    const config = this.deps.config()
    const now = this.now()
    const resolve = this.resolver(config)
    const waiting = this.waitingItems(config, resolve)
    const flows = this.deps.flows().filter((f) => this.hasProject(config, f.projectId))

    const runRows = this.deps.runs().filter((r) => this.hasProject(config, r.projectId))
    const runInfo = this.deps.runStore.startInfo(runRows.map((r) => r.runId))
    const running = buildRunning(
      runRows.map((r) => ({
        runId: r.runId,
        projectId: r.projectId,
        taskId: r.taskId,
        state: r.status === 'queued' ? 'queued' : 'running',
        startedAt: runInfo.get(r.runId)?.startedAt ?? now.toISOString(),
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
    const states = this.deps.board.allStates()
    const projects = views.map((view) =>
      projectCard({
        project: view,
        stages: config.boards[view.id]?.stages ?? null,
        states: states
          .filter((s) => s.projectId === view.id)
          .map((s) => ({
            stageId: s.stageId,
            blocked: s.blocked,
            automationPaused: s.automationPaused
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
    const kinds = query.group
      ? ACTIVITY_KINDS[query.group]
      : [...new Set(Object.values(ACTIVITY_KINDS).flat())]
    // Lê um pouco a mais: alguns eventos (automação sem efeito) ficam de fora.
    const rows = this.deps.board.recentEvents({
      since: new Date(this.now().getTime() - WEEK_MS).toISOString(),
      kinds,
      projectId: query.projectId ?? undefined,
      beforeId: query.beforeId ?? undefined,
      group: query.group === 'board' || query.group === 'automation' ? query.group : undefined,
      limit: limit * 2 + 1
    })
    const items: ActivityPage['items'] = []
    let consumed = 0
    for (const row of rows) {
      if (items.length >= limit) break
      consumed++
      if (!row || !this.hasProject(config, row.projectId)) continue
      const { projectId, taskId, id, at, ...event } = row
      const group = activityGroup(event)
      if (!group || (query.group && group !== query.group)) continue
      const stages = config.boards[projectId]?.stages ?? []
      const stageName = (sid: string | null): string =>
        sid ? (stages.find((s) => s.id === sid)?.name ?? 'etapa removida') : 'Sem etapa'
      items.push({
        ...event,
        id,
        at,
        group,
        task: resolve(projectId, taskId),
        text: describeEvent(event, stageName),
        link: prUrl(event) ?? branchUrl(event),
        section: activitySection(group)
      })
    }
    return { items, hasMore: rows.length > consumed || rows.length > limit * 2 }
  }

  async refresh(): Promise<OverviewSnapshot> {
    const config = this.deps.config()
    const ids = automationProjectIds(config)
    await Promise.all(ids.map((id) => this.deps.refresh(id).catch(() => undefined)))
    return this.snapshot()
  }

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
    for (const r of this.deps.board.unsettledRejections(since)) {
      if (!this.hasProject(config, r.projectId)) continue
      items.push(
        notionWaitingItem(
          {
            type: 'rejected',
            eventId: r.id,
            code: r.kind === 'rolled_back' ? (r.detail.code ?? null) : null,
            at: r.at
          },
          resolve(r.projectId, r.taskId)
        )
      )
    }
    for (const w of this.deps.board.stuckWrites(NOTION_PENDING_ATTEMPTS)) {
      if (!this.hasProject(config, w.projectId)) continue
      items.push(
        notionWaitingItem(
          { type: 'retrying', writeId: w.id, attempts: w.attempts, since: w.createdAt },
          resolve(w.projectId, w.taskPageId)
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
        const branch = this.deps.worktreeBranch(taskId)
        info = { displayId: branch ? displayIdInBranch(branch) : null, title: null }
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

  private week(config: OrkioConfig, now: Date): OverviewSnapshot['week'] {
    const since = new Date(now.getTime() - WEEK_MS).toISOString()
    const from = new Date(now.getTime() - DWELL_LOOKBACK_MS).toISOString()
    const events = this.deps.board
      .stageEvents(from)
      .filter((e) => this.hasProject(config, e.projectId))
    const finals = new Map<string, string>()
    const reviews = new Map<string, string>()
    for (const [projectId, board] of Object.entries(config.boards)) {
      // Etapas pelo papel (o nome não importa): concluída e revisada.
      const done = stageWithRole(board.stages, 'done')
      if (done) finals.set(projectId, done)
      const reviewed = stageWithRole(board.stages, 'reviewed')
      if (reviewed) reviews.set(projectId, reviewed)
    }
    const dwell = stageDwell(events, reviews, since)
    const pulls = pullsInWeek(
      config.projects.filter((p) => p.repo).map((p) => this.deps.pulls(p.id)),
      since
    )
    const runs = this.deps.runStore.costsSince(since).map((cost) => ({ cost }))
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

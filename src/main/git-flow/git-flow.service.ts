/**
 * Fluxo Git no Notion: dentro do ciclo das automações (3B), os eventos do GitHub de cada tarefa
 * viram a "Etapa Git" (e o link/data da PR) no Notion, pela fila própria (`git_flow_writes`).
 *
 * As regras são do motor puro (`shared/git-flow.ts`); aqui ficam o valor de comparação (a escrita
 * pendente, senão a confirmada há pouco, senão o Notion), a idempotência (`gitflow:<chave do
 * evento>` em `task_events`, na transação do ciclo), a pausa, a recusa do Notion (só descarta,
 * sem rollback do quadro) e a carga inicial ao ligar o Fluxo Git.
 */
import type { AutomationEvent, EventKind } from '../../shared/automation'
import {
  gitFlowBackfill,
  gitFlowForEvents,
  type GitFlowChange,
  type GitFlowConfig,
  type GitFlowPr,
  type GitFlowTaskValue
} from '../../shared/git-flow'
import type { NotionTask } from '../../shared/notion'
import { readRepoOf } from '../../shared/projects'
import type { TaskPullRequest, TaskSignals } from '../../shared/task-signals'
import type { BoardStore } from '../board/board.store'
import { NotionWriteQueue, type WriteQueueDeps } from '../board/write-queue'
import type { OrkioConfig } from '../config/orkio-config'
import { automationProjectIds, projectById } from '../config/queries'
import type { PropertyWrites } from '../connectors/notion/notion.schema'
import type { Tx } from '../db/database'
import { errorName } from '../errors'
import type { ConfigStore } from '../storage/config-store'
import type { GitFlowStore, GitFlowWrite } from './git-flow.store'

/** Depois de confirmar uma escrita, quanto tempo o cache do Notion pode mostrar o valor antigo. */
const SYNCED_GRACE_MS = 2 * 60 * 1000

/** Eventos que mexem na Etapa Git (os outros nem são consumidos aqui). */
const GIT_FLOW_EVENTS: ReadonlySet<EventKind> = new Set<EventKind>([
  'branch.created',
  'pr.opened',
  'pr.ready_for_review',
  'pr.changes_requested',
  'pr.review_requested',
  'pr.merged'
])

const REASON = {
  paused: 'automações pausadas',
  same: 'já estava assim',
  joined: 'junto com o evento seguinte'
} as const

export interface GitFlowServiceDeps {
  config: ConfigStore<OrkioConfig>
  store: Pick<BoardStore, 'addEvent' | 'hasEventKey'>
  gitStore: GitFlowStore
  /** Opções da propriedade da Etapa Git na ordem do Notion; `null` = ainda desconhecida. */
  stageOptions(): readonly { id: string; name: string }[] | null
  /** Fila de escrita no Notion (o token fica no conector: `updatePage` só repassa). */
  writes: Omit<WriteQueueDeps<GitFlowWrite>, 'store' | 'onSynced' | 'onRejected' | 'onRetry'>
  /** Algo mudou para a tela do projeto (escrita confirmada ou recusada). */
  onChanged(projectId: string): void
  now?: () => Date
}

interface ApplyInput {
  projectId: string
  taskId: string
  events: readonly AutomationEvent[]
  task: NotionTask | null
  signals: TaskSignals | undefined
  paused: boolean
}

export class GitFlowService {
  readonly writes: NotionWriteQueue<GitFlowWrite>
  private readonly now: () => Date
  /** Valores confirmados há pouco (o cache do Notion ainda pode trazer o anterior). */
  private readonly synced = new Map<string, { value: GitFlowTaskValue; until: number }>()
  /** Carga inicial: projetos já feitos para a propriedade da etapa (`stage.id`). */
  private backfilled = { stageId: '', projects: new Set<string>() }

  constructor(private readonly deps: GitFlowServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.writes = new NotionWriteQueue<GitFlowWrite>({
      ...deps.writes,
      store: deps.gitStore,
      onSynced: (w) => this.onSynced(w),
      onRejected: (w, e) => this.onRejected(w, e),
      onRetry: () => {}
    })
  }

  /**
   * Eventos de uma tarefa no ciclo, dentro da transação de quem chama. Devolve se uma escrita
   * entrou na fila. Cada evento relevante grava `gitflow:<chave>` (aplica uma vez só).
   */
  apply(_tx: Tx, input: ApplyInput): boolean {
    const config = this.deps.config.get()
    const gitFlow = config.notion?.gitFlow
    const order = this.deps.stageOptions()
    if (!gitFlow || !order || !input.task) return false
    const events = input.events.filter(
      (e) =>
        GIT_FLOW_EVENTS.has(e.kind) &&
        !this.deps.store.hasEventKey(input.projectId, input.taskId, gitFlowKey(e))
    )
    if (events.length === 0) return false
    const at = this.now().toISOString()
    const consume = (
      e: AutomationEvent,
      detail: { stage?: string; prNumber?: number; reason?: string }
    ) =>
      this.deps.store.addEvent({
        taskPageId: input.taskId,
        projectId: input.projectId,
        at,
        kind: 'git_flow',
        detail: { event: e.kind, ...detail },
        eventKey: gitFlowKey(e)
      })

    if (input.paused) {
      for (const e of events) consume(e, { reason: REASON.paused })
      return false
    }
    const pr = toGitFlowPr(input.signals?.pr ?? null)
    // Eventos de outra PR que não a principal: sem os dados dela, não decidem nada.
    const usable = events.filter((e) => !e.pr || (pr !== null && e.pr.number === pr.number))
    const repo = readRepoOf(projectById(config, input.projectId))
    const change = gitFlowForEvents(
      usable,
      this.desired(input.task, gitFlow),
      pr,
      repo,
      gitFlow,
      order
    )
    const writes = change ? toWrites(change, gitFlow) : null
    if (!writes || !change) {
      for (const e of events) consume(e, { reason: REASON.same })
      return false
    }
    this.deps.gitStore.merge({
      taskPageId: input.taskId,
      projectId: input.projectId,
      properties: writes,
      now: at
    })
    const last = events.at(-1)!
    for (const e of events.slice(0, -1)) consume(e, { reason: REASON.joined })
    consume(last, {
      ...(change.stage ? { stage: gitFlow.options[change.stage]?.name ?? '' } : {}),
      ...(pr && (change.prUrl || last.pr) ? { prNumber: pr.number } : {})
    })
    return true
  }

  /**
   * Carga inicial ao ligar o Fluxo Git (ou trocar a propriedade da etapa): a etapa de cada tarefa
   * pelo estado atual de branch/PR, com as mesmas regras. Devolve quantas tarefas entraram na
   * fila. `backfilledAt` é gravado quando todos os projetos das automações passaram por aqui.
   */
  backfill(
    _tx: Tx,
    input: { projectId: string; tasks: readonly NotionTask[]; signals: Record<string, TaskSignals> }
  ): number {
    const config = this.deps.config.get()
    const gitFlow = config.notion?.gitFlow
    const order = this.deps.stageOptions()
    if (!gitFlow || gitFlow.backfilledAt !== undefined || !order) return 0
    if (this.backfilled.stageId !== gitFlow.stage.id) {
      this.backfilled = { stageId: gitFlow.stage.id, projects: new Set() }
    }
    if (this.backfilled.projects.has(input.projectId)) return 0

    const repo = readRepoOf(projectById(config, input.projectId))
    const at = this.now().toISOString()
    let count = 0
    for (const task of input.tasks) {
      const s = input.signals[task.id]
      const pr = toGitFlowPr(s?.pr ?? null)
      const hasBranch = (s?.localBranches.length ?? 0) + (s?.remoteBranches.length ?? 0) > 0
      const change = gitFlowBackfill(
        this.desired(task, gitFlow),
        pr,
        hasBranch,
        repo,
        gitFlow,
        order
      )
      const writes = change ? toWrites(change, gitFlow) : null
      if (!writes || !change) continue
      this.deps.gitStore.merge({
        taskPageId: task.id,
        projectId: input.projectId,
        properties: writes,
        now: at
      })
      this.deps.store.addEvent({
        taskPageId: task.id,
        projectId: input.projectId,
        at,
        kind: 'git_flow',
        detail: {
          ...(change.stage ? { stage: gitFlow.options[change.stage]?.name ?? '' } : {}),
          ...(pr && change.prUrl ? { prNumber: pr.number } : {})
        }
      })
      count++
    }
    this.backfilled.projects.add(input.projectId)
    const all = automationProjectIds(config)
    if (all.every((id) => this.backfilled.projects.has(id))) this.markBackfilled(gitFlow.stage.id)
    return count
  }

  /** Grava `backfilledAt` (só se a propriedade da etapa ainda for a mesma). */
  private markBackfilled(stageId: string): void {
    const at = this.now().toISOString()
    this.deps.config
      .update((c) => {
        const gitFlow = c.notion?.gitFlow
        if (!c.notion || !gitFlow || gitFlow.stage.id !== stageId) return c
        return { ...c, notion: { ...c.notion, gitFlow: { ...gitFlow, backfilledAt: at } } }
      })
      .catch((error: unknown) => {
        // Sem gravar, a carga roda de novo no próximo início (as regras não repetem escrita).
        console.error(`[orkio] fluxo git: ${errorName(error)}`)
      })
  }

  /** Valor de comparação: a escrita pendente, senão a confirmada há pouco, senão o Notion. */
  private desired(task: NotionTask, gitFlow: GitFlowConfig): GitFlowTaskValue {
    let value: GitFlowTaskValue = { stage: task.gitStage, prUrl: task.prUrl }
    const synced = this.synced.get(task.id)
    if (synced) {
      if (synced.until < this.now().getTime()) this.synced.delete(task.id)
      else value = mergeValue(value, synced.value)
    }
    const pending = this.deps.gitStore.pending(task.id)
    if (pending) value = mergeValue(value, fromWrites(pending.properties, gitFlow))
    return value
  }

  private onSynced(write: GitFlowWrite): void {
    const gitFlow = this.deps.config.get().notion?.gitFlow
    if (gitFlow) {
      const previous = this.synced.get(write.taskPageId)?.value ?? { stage: null, prUrl: null }
      this.synced.set(write.taskPageId, {
        value: mergeValue(previous, fromWrites(write.properties, gitFlow)),
        until: this.now().getTime() + SYNCED_GRACE_MS
      })
    }
    this.deps.onChanged(write.projectId)
  }

  private onRejected(write: GitFlowWrite, error: { code: string; message: string }): void {
    const gitFlow = this.deps.config.get().notion?.gitFlow
    const stage = gitFlow ? fromWrites(write.properties, gitFlow).stage : null
    this.deps.store.addEvent({
      taskPageId: write.taskPageId,
      projectId: write.projectId,
      at: this.now().toISOString(),
      kind: 'git_flow',
      detail: { ...(stage ? { stage: stage.name } : {}), rejected: error.message }
    })
    this.deps.onChanged(write.projectId)
  }
}

function gitFlowKey(e: AutomationEvent): string {
  return `gitflow:${e.key}`
}

function toGitFlowPr(pr: TaskPullRequest | null): GitFlowPr | null {
  if (!pr) return null
  return {
    number: pr.number,
    url: pr.url,
    baseRef: pr.baseRef ?? null,
    state: pr.state,
    closedAt: pr.closedAt ?? null,
    changesRequested: pr.reviewDecision === 'changes_requested'
  }
}

/** Mudança → propriedades a escrever; campo não mapeado fica de fora. `null` = nada a escrever. */
function toWrites(change: GitFlowChange, gitFlow: GitFlowConfig): PropertyWrites | null {
  const writes: PropertyWrites = {}
  const option = change.stage ? gitFlow.options[change.stage] : undefined
  if (option) writes[gitFlow.stage.id] = { type: gitFlow.stage.type, name: option.name }
  if (change.prUrl && gitFlow.prUrl) writes[gitFlow.prUrl.id] = { type: 'url', url: change.prUrl }
  if (option && change.mergedAt && gitFlow.mergedAt) {
    writes[gitFlow.mergedAt.id] = { type: 'date', start: change.mergedAt }
  }
  return Object.keys(writes).length > 0 ? writes : null
}

/** O que uma escrita do Fluxo Git diz da etapa e do link (o resto fica `null`). */
function fromWrites(writes: PropertyWrites, gitFlow: GitFlowConfig): GitFlowTaskValue {
  const stage = writes[gitFlow.stage.id]
  const url = gitFlow.prUrl ? writes[gitFlow.prUrl.id] : undefined
  const option =
    stage && (stage.type === 'select' || stage.type === 'status')
      ? Object.values(gitFlow.options).find((o) => o.name === stage.name)
      : undefined
  return {
    stage:
      stage && (stage.type === 'select' || stage.type === 'status')
        ? { id: option?.id ?? null, name: stage.name }
        : null,
    prUrl: url?.type === 'url' ? url.url : null
  }
}

function mergeValue(base: GitFlowTaskValue, over: GitFlowTaskValue): GitFlowTaskValue {
  return { stage: over.stage ?? base.stage, prUrl: over.prUrl ?? base.prUrl }
}

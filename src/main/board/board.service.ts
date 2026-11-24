/**
 * Quadro kanban por projeto (Etapa 3A). Roda no main.
 *
 * - Configuração das etapas no ConfigStore (`boards[projectId]`); estado local, histórico e
 *   escritas pendentes no SQLite (BoardStore).
 * - Ao abrir/atualizar: reconcilia o estado local com o status atual de cada tarefa no Notion.
 * - Mover/bloquear: grava localmente na hora (otimista) e enfileira a escrita no Notion
 *   (NotionWriteQueue), que confirma, tenta de novo ou desfaz.
 */
import { WEEK_MS } from '../../shared/overview'
import type { StageFlow } from '../../shared/task-flow'
import { defaultRules } from '../../shared/automation'
import { upgradeAlvaFlows } from '../../shared/alva-templates'
import { diffFlow, toBoardStages, validateFlow, type FlowDraft } from '../../shared/flow'
import {
  findOption,
  reconcile,
  stageMatchesStatus,
  suggestStages,
  validateStages,
  type BoardConfig,
  type BoardStage,
  type ReconcileTask,
  type StatusOption
} from '../../shared/board'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardSaveInput,
  BoardSyncEvent,
  BoardView,
  ConfigEvent,
  NotionMapping,
  NotionPropertySummary,
  NotionResult
} from '../../shared/ipc-contract'
import type { OrkioConfig } from '../config/orkio-config'
import { NotionApiError } from '../connectors/notion/notion.client'
import type { SimplePropertyValue } from '../connectors/notion/notion.schema'
import type { CachedTasks } from '../notion/notion-workspace.service'
import { ConfigReadOnlyError, type ConfigStore } from '../storage/config-store'
import type { BoardStore, PendingWrite } from './board.store'
import type { NotionWriteQueue } from './write-queue'

type Err = Extract<NotionResult<never>, { ok: false }>['error']

export interface BoardNotion {
  boardTasks(
    projectId: string,
    options?: { force?: boolean }
  ): Promise<
    NotionResult<
      CachedTasks & { fromCache: boolean; mapping: NotionMapping; tasksDataSourceId: string }
    >
  >
  statusOptions(): Promise<
    NotionResult<{
      options: StatusOption[]
      statusType: string
      properties: NotionPropertySummary[]
    }>
  >
  invalidateTasks(projectId: string): void
  updateDataSource(id: string, properties: Record<string, unknown>): Promise<unknown>
  connectionMethod(): Promise<'oauth' | 'token' | null>
}

export interface BoardServiceDeps {
  config: ConfigStore<OrkioConfig>
  store: BoardStore
  notion: BoardNotion
  /** A fila é criada fora (precisa dos callbacks deste serviço): ligue com `attachQueue`. */
  onSync(event: BoardSyncEvent): void
  now?: () => Date
  newId?: () => string
  /** Depois de confirmar uma escrita, quanto tempo o Notion pode demorar a refletir (ms). */
  graceMs?: number
  /** "Quem" nos eventos de configuração (usuário do sistema operacional). */
  actor?: () => string
  /**
   * A etapa local de uma tarefa mudou (5A: fluxos). Chamado dentro da transação; quem ouve deve
   * adiar o trabalho. `source` diz se foi entrada real (manual/automação) ou não.
   */
  onStageChanged?: (change: StageChange) => void
}

export interface StageChange {
  projectId: string
  taskId: string
  from: string | null
  to: string | null
  source: 'manual' | 'automation' | 'notion' | 'rollback' | 'stage_removed'
}

export const BOARD_MESSAGES = {
  notFound: 'Projeto não encontrado. Atualize a lista.',
  notLinked: 'Vincule este projeto a um projeto do Notion (em Projetos) para abrir o quadro.',
  noBoard: 'Crie o quadro deste projeto antes de mover tarefas.',
  stageNotFound: 'Essa etapa não existe mais no quadro. Atualize a tela.',
  taskNotFound: 'Tarefa não encontrada no quadro. Clique em Atualizar.',
  storage: 'Não foi possível salvar a configuração do quadro. Tente novamente.',
  readOnly: 'As configurações estão em modo só leitura. Atualize o Orkio para salvar mudanças.',
  unknown: 'Algo deu errado no quadro. Tente novamente.',
  stageNeedsOption: 'Escolha uma opção de status do Notion que exista para cada etapa.',
  orkioPropertyExists:
    'Já existe uma propriedade “Etapa Orkio” no banco de Tarefas. Escolha “usar existente”.',
  orkioPropertyInvalid: 'Escolha uma propriedade do tipo seleção (select) para a Etapa Orkio.',
  blockedPropertyInvalid:
    'Escolha uma propriedade do tipo caixa de seleção (checkbox) para Bloqueada.',
  pending: 'Aguardando o Notion…',
  retrying: 'Sem conexão com o Notion: a mudança será enviada assim que possível.'
} as const

export const ORKIO_STAGE_PROPERTY_NAME = 'Etapa Orkio'

class BoardError extends Error {
  constructor(readonly info: Err) {
    super(info.message)
    this.name = 'BoardError'
  }
}

interface Snapshot {
  data: CachedTasks & { mapping: NotionMapping; tasksDataSourceId: string }
  statusType: string
}

export class BoardService {
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly graceMs: number
  private queue: NotionWriteQueue | null = null
  /** Últimas tarefas lidas por projeto (mover offline usa os valores conhecidos do Notion). */
  private readonly snapshots = new Map<string, Snapshot>()
  /** Escritas confirmadas há pouco: o Notion pode ainda devolver o valor antigo na consulta. */
  private readonly recent = new Map<
    string,
    { properties: Record<string, unknown>; until: number }
  >()
  /** Última mensagem de falha transitória por tarefa (exibida no card). */
  private readonly retryMessages = new Map<string, string>()

  constructor(private readonly deps: BoardServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => `stage-${crypto.randomUUID()}`)
    this.graceMs = deps.graceMs ?? 30_000
  }

  attachQueue(queue: NotionWriteQueue): void {
    this.queue = queue
  }

  // ---------- Abrir / reconciliar ----------

  async get(
    projectId: string,
    options: { force?: boolean } = {}
  ): Promise<NotionResult<BoardView>> {
    return this.wrap(() => this.load(projectId, options.force === true))
  }

  private async load(projectId: string, force: boolean): Promise<BoardView> {
    const project = this.project(projectId)
    const optionsResult = await this.deps.notion.statusOptions()
    if (!optionsResult.ok) throw new BoardError(optionsResult.error)
    const { options, statusType, properties } = optionsResult.value
    const selectProperties = properties
      .filter((p) => p.type === 'select')
      .map((p) => ({
        id: p.id,
        name: p.name,
        options: (p.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color }))
      }))
    const checkboxProperties = properties
      .filter((p) => p.type === 'checkbox')
      .map((p) => ({ id: p.id, name: p.name }))

    const board = this.deps.config.get().boards[projectId] ?? null
    const tasksResult = await this.deps.notion.boardTasks(projectId, { force })
    if (!tasksResult.ok) throw new BoardError(tasksResult.error)
    const data = tasksResult.value
    this.snapshots.set(projectId, { data, statusType })

    const base = {
      projectId,
      projectName: project.name,
      statusOptions: options,
      selectProperties,
      checkboxProperties,
      truncated: data.truncated,
      fetchedAt: data.fetchedAt,
      ruleCountsWeek: this.deps.store.ruleCounts(
        projectId,
        new Date(this.now().getTime() - WEEK_MS).toISOString()
      )
    }

    if (!board) {
      return {
        ...base,
        config: null,
        suggestion: suggestStages(options, undefined, () => this.newId()),
        issues: [],
        cards: [],
        pendingCount: 0
      }
    }

    const validated = validateStages(board.stages, options)
    const stages = validated.stages
    const config: BoardConfig = { ...board, stages }

    // Reconciliação.
    const pending = new Set(this.deps.store.pendingForProject(projectId).map((w) => w.taskPageId))
    const nowMs = this.now().getTime()
    // "Atualizar" (force) é um pedido explícito pela verdade do Notion: sem janela de espera.
    if (force) this.recent.clear()
    for (const [taskId, recent] of this.recent) {
      if (recent.until < nowMs || this.notionHas(data.values[taskId], recent.properties)) {
        this.recent.delete(taskId)
      } else pending.add(taskId)
    }
    const states = this.deps.store.states(projectId)
    const reconcileTasks: ReconcileTask[] = data.tasks.map((t) => {
      const values = data.values[t.id] ?? {}
      const orkio = config.orkioStageProperty ? values[config.orkioStageProperty.id] : undefined
      const blocked = config.blockedProperty ? values[config.blockedProperty.id] : undefined
      return {
        id: t.id,
        status: t.status ? { id: t.status.id ?? null, name: t.status.name } : null,
        orkioStage: orkio && orkio.type !== 'checkbox' ? orkio.name : null,
        blocked: blocked && blocked.type === 'checkbox' ? blocked.checked : null
      }
    })
    const decisions = reconcile(reconcileTasks, states, stages, pending)
    const at = this.now().toISOString()
    this.deps.store.transaction(() => {
      for (const d of decisions) {
        if (!d.changed) continue
        this.deps.store.upsertState({
          taskPageId: d.taskId,
          projectId,
          stageId: d.stageId,
          blocked: d.blocked,
          updatedAt: at,
          source: 'notion'
        })
        if (d.from === undefined) {
          this.deps.store.addEvent({
            taskPageId: d.taskId,
            projectId,
            at,
            kind: 'added',
            source: 'notion',
            fromStage: null,
            toStage: d.stageId,
            detail: null
          })
        } else if (d.from !== d.stageId) {
          this.deps.onStageChanged?.({
            projectId,
            taskId: d.taskId,
            from: d.from,
            to: d.stageId,
            source: 'notion'
          })
          this.deps.store.addEvent({
            taskPageId: d.taskId,
            projectId,
            at,
            kind: 'reconciled',
            source: 'notion',
            fromStage: d.from,
            toStage: d.stageId,
            detail: { status: reconcileTasks.find((t) => t.id === d.taskId)?.status?.name ?? null }
          })
        }
        if (d.blockedChanged && d.from !== undefined) {
          this.deps.store.addEvent({
            taskPageId: d.taskId,
            projectId,
            at,
            kind: d.blocked ? 'blocked' : 'unblocked',
            source: 'notion',
            fromStage: null,
            toStage: null,
            detail: null
          })
        }
      }
    })

    const byId = new Map(decisions.map((d) => [d.taskId, d]))
    const pendingNow = new Set(
      this.deps.store.pendingForProject(projectId).map((w) => w.taskPageId)
    )
    const cards: BoardCard[] = data.tasks.map((t) => {
      const d = byId.get(t.id)!
      return {
        taskId: t.id,
        displayId: t.displayId,
        title: t.title,
        url: t.url,
        status: t.status ? { name: t.status.name, color: t.status.color } : null,
        priority: t.priority,
        assignees: t.assignees,
        stageId: d.stageId,
        blocked: d.blocked,
        automationPaused: states.get(t.id)?.automationPaused ?? false,
        sync: pendingNow.has(t.id)
          ? { state: 'pending', message: this.retryMessages.get(t.id) ?? BOARD_MESSAGES.pending }
          : { state: 'synced' }
      }
    })

    return {
      ...base,
      config,
      suggestion: null,
      issues: validated.issues,
      cards,
      pendingCount: pendingNow.size
    }
  }

  // ---------- Mover / bloquear ----------

  async move(projectId: string, taskId: string, stageId: string): Promise<NotionResult<BoardCard>> {
    return this.wrap(async () => {
      const moved = this.deps.store.transaction(() =>
        this.applyMove(projectId, taskId, stageId, { source: 'manual' })
      )
      if (moved) this.queue?.kick()
      return this.card(projectId, taskId)
    })
  }

  /**
   * Mesmo caminho do movimento manual, para as automações (3B): estado local, evento com a chave
   * de idempotência e a regra, e a escrita pendente no Notion. Chame dentro de uma transação
   * (junto com o snapshot e a chave). Devolve se moveu.
   */
  applyAutomationMove(
    projectId: string,
    taskId: string,
    stageId: string,
    event: { key: string; detail: Record<string, unknown> }
  ): boolean {
    return this.applyMove(projectId, taskId, stageId, {
      source: 'automation',
      eventKey: event.key,
      detail: event.detail
    })
  }

  /** Depois de um ciclo de automações: envia as escritas e avisa a tela. */
  flushWrites(): void {
    this.queue?.kick()
  }

  /** As tarefas já foram carregadas nesta sessão (necessário para mover)? */
  hasSnapshot(projectId: string): boolean {
    return this.snapshots.has(projectId)
  }

  private applyMove(
    projectId: string,
    taskId: string,
    stageId: string,
    options: {
      source: 'manual' | 'automation'
      eventKey?: string
      detail?: Record<string, unknown>
      /** Remoção de etapa na 3C: move sem contar como entrada (não dispara fluxos). */
      stageRemoved?: boolean
    }
  ): boolean {
    const { board, snapshot, task } = this.context(projectId, taskId)
    const stage = board.stages.find((s) => s.id === stageId)
    if (!stage) throw new BoardError({ code: 'not_found', message: BOARD_MESSAGES.stageNotFound })
    const before = this.localState(projectId, taskId)
    if (before.stageId === stageId) return false
    const at = this.now().toISOString()
    const statusChange = stageMatchesStatus(
      stage,
      task.status ? { id: task.status.id ?? null, name: task.status.name } : null
    )
      ? {}
      : { notionStatus: stage.notionStatus.name }
    this.deps.store.upsertState({
      taskPageId: taskId,
      projectId,
      stageId,
      blocked: before.blocked,
      updatedAt: at,
      source: options.source
    })
    const detail = { ...options.detail, ...statusChange }
    this.deps.store.addEvent({
      taskPageId: taskId,
      projectId,
      at,
      kind: 'moved',
      source: options.source,
      fromStage: before.stageId,
      toStage: stageId,
      detail: Object.keys(detail).length > 0 ? detail : null,
      eventKey: options.eventKey ?? null
    })
    this.syncDesired(projectId, taskId, board, snapshot, before)
    this.deps.onStageChanged?.({
      projectId,
      taskId,
      from: before.stageId,
      to: stageId,
      source: options.stageRemoved ? 'stage_removed' : options.source
    })
    return true
  }

  /** Pausa/retoma as automações de uma tarefa (registrado no histórico). */
  async setAutomationPaused(
    projectId: string,
    taskId: string,
    paused: boolean
  ): Promise<NotionResult<BoardCard>> {
    return this.wrap(async () => {
      this.context(projectId, taskId)
      const at = this.now().toISOString()
      this.deps.store.transaction(() => {
        this.deps.store.setAutomationPaused(taskId, projectId, paused, at)
        this.deps.store.addEvent({
          taskPageId: taskId,
          projectId,
          at,
          kind: paused ? 'automation_paused' : 'automation_resumed',
          source: 'manual',
          fromStage: null,
          toStage: null,
          detail: null
        })
      })
      return this.card(projectId, taskId)
    })
  }

  async setBlocked(
    projectId: string,
    taskId: string,
    blocked: boolean
  ): Promise<NotionResult<BoardCard>> {
    return this.wrap(async () => {
      const { board, snapshot } = this.context(projectId, taskId)
      const before = this.localState(projectId, taskId)
      if (before.blocked === blocked) return this.card(projectId, taskId)
      const at = this.now().toISOString()
      this.deps.store.transaction(() => {
        this.deps.store.upsertState({
          taskPageId: taskId,
          projectId,
          stageId: before.stageId,
          blocked,
          updatedAt: at,
          source: 'manual'
        })
        this.deps.store.addEvent({
          taskPageId: taskId,
          projectId,
          at,
          kind: blocked ? 'blocked' : 'unblocked',
          source: 'manual',
          fromStage: null,
          toStage: null,
          detail: null
        })
        this.syncDesired(projectId, taskId, board, snapshot, before)
      })
      this.queue?.kick()
      return this.card(projectId, taskId)
    })
  }

  async history(projectId: string, taskId: string): Promise<NotionResult<BoardHistoryEntry[]>> {
    return this.wrap(async () => {
      this.project(projectId)
      return this.deps.store.events(taskId).map((e) => ({
        id: e.id,
        at: e.at,
        kind: e.kind,
        source: e.source,
        fromStage: e.fromStage,
        toStage: e.toStage,
        detail: e.detail
      }))
    })
  }

  retryNow(): void {
    this.queue?.retryAllNow()
  }

  /**
   * Calcula o que o Notion precisa ter para refletir o estado local e grava/atualiza/remove a
   * pendência. Comparado com os últimos valores conhecidos do Notion, não com a mudança: mover e
   * voltar antes de sincronizar cancela a escrita.
   */
  private syncDesired(
    projectId: string,
    taskId: string,
    board: BoardConfig,
    snapshot: Snapshot,
    rollback: { stageId: string | null; blocked: boolean }
  ): void {
    const state = this.localState(projectId, taskId)
    const task = snapshot.data.tasks.find((t) => t.id === taskId)!
    const values = snapshot.data.values[taskId] ?? {}
    const properties: Record<string, unknown> = {}
    const stage = board.stages.find((s) => s.id === state.stageId)
    if (stage) {
      const status = task.status ? { id: task.status.id ?? null, name: task.status.name } : null
      if (!stageMatchesStatus(stage, status)) {
        const type = snapshot.statusType === 'select' ? 'select' : 'status'
        properties[snapshot.data.mapping.status.id] = { [type]: { name: stage.notionStatus.name } }
      }
      const orkio = board.orkioStageProperty
      if (orkio) {
        const current = values[orkio.id]
        if (!current || current.type === 'checkbox' || current.name !== stage.name) {
          properties[orkio.id] = { select: { name: stage.name } }
        }
      }
    }
    const blockedProp = board.blockedProperty
    if (blockedProp) {
      const current = values[blockedProp.id]
      const notionBlocked = current?.type === 'checkbox' ? current.checked : false
      if (notionBlocked !== state.blocked) properties[blockedProp.id] = { checkbox: state.blocked }
    }

    if (Object.keys(properties).length === 0) {
      this.deps.store.deletePending(taskId)
      this.retryMessages.delete(taskId)
      return
    }
    this.deps.store.upsertPending({
      taskPageId: taskId,
      projectId,
      properties,
      rollback,
      now: this.now().toISOString()
    })
  }

  // ---------- Resultados da fila ----------

  onSynced(write: PendingWrite): void {
    this.retryMessages.delete(write.taskPageId)
    this.recent.set(write.taskPageId, {
      properties: write.properties,
      until: this.now().getTime() + this.graceMs
    })
    this.applyToSnapshot(write)
    this.deps.notion.invalidateTasks(write.projectId)
    const state = this.localState(write.projectId, write.taskPageId)
    this.deps.store.addEvent({
      taskPageId: write.taskPageId,
      projectId: write.projectId,
      at: this.now().toISOString(),
      kind: 'sync_ok',
      source: 'manual',
      fromStage: null,
      toStage: state.stageId,
      detail: null
    })
    this.deps.onSync({
      projectId: write.projectId,
      taskId: write.taskPageId,
      state: 'synced',
      stageId: state.stageId,
      blocked: state.blocked
    })
  }

  async onRejected(write: PendingWrite, error: { code: string; message: string }): Promise<void> {
    this.retryMessages.delete(write.taskPageId)
    const before = this.localState(write.projectId, write.taskPageId)
    const at = this.now().toISOString()
    this.deps.store.transaction(() => {
      this.deps.store.upsertState({
        taskPageId: write.taskPageId,
        projectId: write.projectId,
        stageId: write.rollback.stageId,
        blocked: write.rollback.blocked,
        updatedAt: at,
        source: 'manual'
      })
      this.deps.store.addEvent({
        taskPageId: write.taskPageId,
        projectId: write.projectId,
        at,
        kind: 'rolled_back',
        source: 'manual',
        fromStage: before.stageId,
        toStage: write.rollback.stageId,
        detail: { code: error.code }
      })
    })
    if (before.stageId !== write.rollback.stageId) {
      this.deps.onStageChanged?.({
        projectId: write.projectId,
        taskId: write.taskPageId,
        from: before.stageId,
        to: write.rollback.stageId,
        source: 'rollback'
      })
    }
    const canReconnect =
      error.code === 'not_found' &&
      (await this.deps.notion.connectionMethod().catch(() => null)) === 'oauth'
    this.deps.onSync({
      projectId: write.projectId,
      taskId: write.taskPageId,
      state: 'failed',
      stageId: write.rollback.stageId,
      blocked: write.rollback.blocked,
      message: `O Notion recusou a mudança e o card voltou. ${error.message}`,
      ...(canReconnect ? { canReconnect: true } : {})
    })
  }

  onRetry(write: PendingWrite, error: { code: string; message: string }): void {
    const auth =
      error.code === 'unauthorized' ||
      error.code === 'invalid_grant' ||
      error.code === 'not_connected'
    const message = auth
      ? `${error.message} A mudança será enviada depois de reconectar.`
      : BOARD_MESSAGES.retrying
    this.retryMessages.set(write.taskPageId, message)
    const state = this.localState(write.projectId, write.taskPageId)
    this.deps.onSync({
      projectId: write.projectId,
      taskId: write.taskPageId,
      state: 'pending',
      stageId: state.stageId,
      blocked: state.blocked,
      message,
      ...(auth ? { canReconnect: true } : {})
    })
  }

  // ---------- Fluxo (3C) ----------

  /**
   * Salva etapas + automações do editor de fluxo. Valida de novo aqui (mesma função pura da tela),
   * move as tarefas das etapas removidas para o destino escolhido (mesmo caminho do movimento
   * manual, com escrita no Notion se o status mudar) e registra o evento de configuração.
   */
  async saveFlow(projectId: string, draft: FlowDraft): Promise<NotionResult<BoardView>> {
    return this.wrap(async () => {
      this.project(projectId)
      const previous = this.deps.config.get().boards[projectId]
      if (!previous) {
        throw new BoardError({ code: 'not_configured', message: BOARD_MESSAGES.noBoard })
      }
      const optionsResult = await this.deps.notion.statusOptions()
      if (!optionsResult.ok) throw new BoardError(optionsResult.error)
      const { options } = optionsResult.value

      const issues = validateFlow(draft, {
        statusOptions: options,
        savedStageIds: previous.stages.map((s) => s.id),
        taskCounts: this.deps.store.taskCounts(projectId)
      }).filter((i) => i.level === 'error')
      if (issues.length > 0) {
        throw new BoardError({ code: 'invalid', message: issues.map((i) => i.message).join(' ') })
      }

      // Garante as tarefas em memória para mover as das etapas removidas.
      if (!this.snapshots.has(projectId)) await this.load(projectId, false)

      const stages = toBoardStages(draft.stages, options)
      const board: BoardConfig = {
        ...previous,
        stages,
        rules: draft.rules,
        updatedAt: this.now().toISOString()
      }
      // 5A: ligações etapa → fluxo de tarefa (só para etapas e fluxos que existem).
      const current = this.deps.config.get().flows[projectId] ?? { flows: [], bindings: [] }
      const flowIds = new Set(current.flows.map((f) => f.id))
      const bindings = (draft.bindings ?? current.bindings).filter(
        (b, i, all) =>
          stages.some((st) => st.id === b.stageId) &&
          flowIds.has(b.flowId) &&
          all.findIndex((x) => x.stageId === b.stageId) === i
      )
      try {
        await this.deps.config.update((c) => ({
          ...c,
          boards: { ...c.boards, [projectId]: board },
          flows: { ...c.flows, [projectId]: { ...current, bindings } }
        }))
      } catch (e) {
        throw new BoardError({
          code: 'storage',
          message:
            e instanceof ConfigReadOnlyError ? BOARD_MESSAGES.readOnly : BOARD_MESSAGES.storage
        })
      }

      const changes = diffFlow(previous, board)
      changes.push(...diffBindings(current.bindings, bindings, stages, current.flows))
      let moved = 0
      this.deps.store.transaction(() => {
        for (const removed of previous.stages) {
          if (stages.some((s) => s.id === removed.id)) continue
          const destination = draft.removals[removed.id]
          const tasks = this.deps.store.tasksInStage(projectId, removed.id)
          for (const taskId of tasks) {
            if (
              !destination ||
              !this.snapshots.get(projectId)?.data.tasks.some((t) => t.id === taskId)
            ) {
              continue
            }
            if (
              this.applyMove(projectId, taskId, destination, {
                source: 'manual',
                detail: { flow: 'stage_removed', removedStage: removed.name },
                stageRemoved: true
              })
            ) {
              moved++
            }
          }
          if (tasks.length > 0 && destination) {
            const name = stages.find((s) => s.id === destination)?.name ?? ''
            changes.push(`Tarefas de “${removed.name}” movidas para “${name}”`)
          }
        }
        if (changes.length > 0) {
          this.deps.store.addConfigEvent(projectId, this.now().toISOString(), this.actor(), changes)
        }
      })
      if (moved > 0) this.queue?.kick()
      return this.load(projectId, false)
    })
  }

  async configEvents(projectId: string): Promise<ConfigEvent[]> {
    this.project(projectId)
    return this.deps.store.configEvents(projectId)
  }

  private actor(): string {
    try {
      return this.deps.actor?.() || 'você'
    } catch {
      return 'você'
    }
  }

  // ---------- Configuração ----------

  async save(projectId: string, input: BoardSaveInput): Promise<NotionResult<BoardView>> {
    return this.wrap(async () => {
      this.project(projectId)
      const optionsResult = await this.deps.notion.statusOptions()
      if (!optionsResult.ok) throw new BoardError(optionsResult.error)
      const { options, properties } = optionsResult.value
      const previous = this.deps.config.get().boards[projectId]

      const draft: BoardStage[] = input.stages.map((s, index) => {
        const option = options.find((o) => o.id === s.notionStatusId)
        const keep = s.id ? previous?.stages.find((p) => p.id === s.id) : undefined
        return {
          id: keep?.id ?? this.newId(),
          name: s.name,
          order: index,
          notionStatus: option
            ? { id: option.id, name: option.name }
            : { id: null, name: s.notionStatusId },
          ...(option ? { color: option.color } : {})
        }
      })
      const { stages, issues } = validateStages(draft, options)
      const errors = issues.filter((i) => i.level === 'error')
      if (errors.length > 0) {
        throw new BoardError({ code: 'invalid', message: errors.map((e) => e.message).join(' ') })
      }

      let orkioStageProperty: BoardConfig['orkioStageProperty'] = null
      const config = this.deps.config.get().notion
      if (input.orkioStage.mode !== 'none' && !config) {
        throw new BoardError({ code: 'not_configured', message: BOARD_MESSAGES.notLinked })
      }
      if (input.orkioStage.mode === 'existing') {
        const prop = properties.find(
          (p) => p.id === (input.orkioStage as { propertyId: string }).propertyId
        )
        if (!prop || prop.type !== 'select') {
          throw new BoardError({ code: 'invalid', message: BOARD_MESSAGES.orkioPropertyInvalid })
        }
        const missing = uniqueNames(stages).filter(
          (name) => !(prop.options ?? []).some((o) => o.name === name)
        )
        if (missing.length > 0) {
          if (!input.addMissingOptions) {
            throw new BoardError({
              code: 'needs_confirmation',
              message: `A propriedade “${prop.name}” não tem as opções: ${missing.join(', ')}. Confirme para adicioná-las no Notion.`
            })
          }
          await this.deps.notion.updateDataSource(config!.tasksDataSource.id, {
            [prop.id]: {
              select: {
                options: [
                  ...(prop.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color })),
                  ...missing.map((name) => ({ name, color: colorFor(stages, name) }))
                ]
              }
            }
          })
        }
        orkioStageProperty = { id: prop.id, name: prop.name }
      } else if (input.orkioStage.mode === 'create') {
        if (properties.some((p) => p.name === ORKIO_STAGE_PROPERTY_NAME)) {
          throw new BoardError({ code: 'invalid', message: BOARD_MESSAGES.orkioPropertyExists })
        }
        const updated = await this.deps.notion.updateDataSource(config!.tasksDataSource.id, {
          [ORKIO_STAGE_PROPERTY_NAME]: {
            select: {
              options: uniqueNames(stages).map((name) => ({ name, color: colorFor(stages, name) }))
            }
          }
        })
        const id = propertyIdByName(updated, ORKIO_STAGE_PROPERTY_NAME)
        if (!id) {
          throw new BoardError({
            code: 'unexpected',
            message:
              'O Notion criou a propriedade, mas não devolveu o id. Atualize e escolha “usar existente”.'
          })
        }
        orkioStageProperty = { id, name: ORKIO_STAGE_PROPERTY_NAME }
      }

      let blockedProperty: BoardConfig['blockedProperty'] = null
      if (input.blockedPropertyId) {
        const prop = properties.find((p) => p.id === input.blockedPropertyId)
        if (!prop || prop.type !== 'checkbox') {
          throw new BoardError({ code: 'invalid', message: BOARD_MESSAGES.blockedPropertyInvalid })
        }
        blockedProperty = { id: prop.id, name: prop.name }
      }

      const board: BoardConfig = {
        stages,
        orkioStageProperty,
        blockedProperty,
        // Quadro novo ganha as regras padrão; ajustar etapas mantém as regras (editor na 3C).
        rules: previous?.rules ?? defaultRules(stages).rules,
        updatedAt: this.now().toISOString()
      }
      // Quadro novo num projeto que já usa os modelos Alva: Revisando/Revisado ganham os fluxos
      // padrão (só colunas sem fluxo; fluxos do usuário não mudam). Calculado dentro da escrita,
      // sobre a config do momento (nenhuma escrita de fluxos no meio se perde).
      let alvaChanges: string[] = []
      try {
        await this.deps.config.update((c) => {
          alvaChanges = []
          const next = { ...c, boards: { ...c.boards, [projectId]: board } }
          if (previous) return next
          const alva = upgradeAlvaFlows(c.flows[projectId] ?? { flows: [], bindings: [] }, stages)
          if (alva.changes.length === 0) return next
          alvaChanges = alva.changes
          return { ...next, flows: { ...c.flows, [projectId]: alva.flows } }
        })
      } catch (e) {
        throw new BoardError({
          code: 'storage',
          message:
            e instanceof ConfigReadOnlyError ? BOARD_MESSAGES.readOnly : BOARD_MESSAGES.storage
        })
      }
      const changes = previous
        ? diffFlow(previous, board)
        : [
            `Quadro criado com ${stages.length} etapas e ${board.rules.length} automações`,
            ...alvaChanges
          ]
      if (changes.length > 0) {
        this.deps.store.addConfigEvent(projectId, this.now().toISOString(), this.actor(), changes)
      }
      if (orkioStageProperty) this.deps.notion.invalidateTasks(projectId)
      return this.load(projectId, orkioStageProperty !== null)
    })
  }

  // ---------- Auxiliares ----------

  private project(projectId: string) {
    const project = this.deps.config.get().projects.find((p) => p.id === projectId)
    if (!project) throw new BoardError({ code: 'not_found', message: BOARD_MESSAGES.notFound })
    if (!project.notionProject) {
      throw new BoardError({ code: 'not_linked', message: BOARD_MESSAGES.notLinked })
    }
    return project
  }

  private context(projectId: string, taskId: string) {
    this.project(projectId)
    const board = this.deps.config.get().boards[projectId]
    if (!board) throw new BoardError({ code: 'not_configured', message: BOARD_MESSAGES.noBoard })
    const snapshot = this.snapshots.get(projectId)
    const task = snapshot?.data.tasks.find((t) => t.id === taskId)
    if (!snapshot || !task) {
      throw new BoardError({ code: 'not_found', message: BOARD_MESSAGES.taskNotFound })
    }
    return { board, snapshot, task }
  }

  private localState(
    projectId: string,
    taskId: string
  ): { stageId: string | null; blocked: boolean } {
    const state = this.deps.store.state(taskId)
    return state && state.projectId === projectId
      ? { stageId: state.stageId, blocked: state.blocked }
      : { stageId: null, blocked: false }
  }

  private card(projectId: string, taskId: string): BoardCard {
    const snapshot = this.snapshots.get(projectId)!
    const task = snapshot.data.tasks.find((t) => t.id === taskId)!
    const state = this.localState(projectId, taskId)
    const pending = this.deps.store.pending(taskId)
    return {
      taskId,
      displayId: task.displayId,
      title: task.title,
      url: task.url,
      status: task.status ? { name: task.status.name, color: task.status.color } : null,
      priority: task.priority,
      assignees: task.assignees,
      stageId: state.stageId,
      blocked: state.blocked,
      automationPaused: this.deps.store.state(taskId)?.automationPaused ?? false,
      sync: pending
        ? { state: 'pending', message: this.retryMessages.get(taskId) ?? BOARD_MESSAGES.pending }
        : { state: 'synced' }
    }
  }

  /** Depois de confirmar, os valores conhecidos do Notion passam a ser os escritos. */
  private applyToSnapshot(write: PendingWrite): void {
    const snapshot = this.snapshots.get(write.projectId)
    if (!snapshot) return
    const values = (snapshot.data.values[write.taskPageId] ??= {})
    const task = snapshot.data.tasks.find((t) => t.id === write.taskPageId)
    for (const [propId, raw] of Object.entries(write.properties)) {
      const v = raw as Record<string, { name?: string } | boolean>
      if (typeof v['checkbox'] === 'boolean') {
        values[propId] = { type: 'checkbox', checked: v['checkbox'] }
        continue
      }
      const type = 'status' in v ? 'status' : 'select'
      const name = (v[type] as { name?: string } | undefined)?.name ?? null
      values[propId] = { type, id: null, name }
      if (task && propId === snapshot.data.mapping.status.id && name) {
        task.status = { id: null, name, color: task.status?.color ?? 'default' }
      }
    }
  }

  private notionHas(
    values: Record<string, SimplePropertyValue> | undefined,
    properties: Record<string, unknown>
  ): boolean {
    if (!values) return false
    return Object.entries(properties).every(([propId, raw]) => {
      const current = values[propId]
      const v = raw as Record<string, { name?: string } | boolean>
      if (typeof v['checkbox'] === 'boolean') {
        return current?.type === 'checkbox' && current.checked === v['checkbox']
      }
      const wanted = (v['status'] ?? v['select']) as { name?: string } | undefined
      return current !== undefined && current.type !== 'checkbox' && current.name === wanted?.name
    })
  }

  private async wrap<T>(run: () => Promise<T>): Promise<NotionResult<T>> {
    try {
      return { ok: true, value: await run() }
    } catch (e) {
      if (e instanceof BoardError) return { ok: false, error: e.info }
      if (e instanceof NotionApiError) {
        const canReconnect =
          e.code === 'unauthorized' ||
          e.code === 'invalid_grant' ||
          (e.code === 'not_found' &&
            (await this.deps.notion.connectionMethod().catch(() => null)) === 'oauth')
        return {
          ok: false,
          error: { code: e.code, message: e.message, ...(canReconnect ? { canReconnect } : {}) }
        }
      }
      return { ok: false, error: { code: 'unexpected', message: BOARD_MESSAGES.unknown } }
    }
  }
}

function uniqueNames(stages: readonly BoardStage[]): string[] {
  return [...new Set(stages.map((s) => s.name))]
}

function colorFor(stages: readonly BoardStage[], name: string): string {
  return stages.find((s) => s.name === name)?.color ?? 'default'
}

function propertyIdByName(body: unknown, name: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const props = (body as { properties?: unknown }).properties
  if (typeof props !== 'object' || props === null) return null
  const prop = (props as Record<string, unknown>)[name]
  if (typeof prop !== 'object' || prop === null) return null
  const id = (prop as { id?: unknown }).id
  return typeof id === 'string' && id ? id : null
}

/** Para testes e para o painel: nome da opção de status para uma etapa. */
export function optionForStage(
  options: readonly StatusOption[],
  stage: BoardStage
): StatusOption | null {
  return findOption(options, stage.notionStatus)
}

/** Frases do histórico de configuração para as ligações etapa → fluxo (5A). */
function diffBindings(
  before: readonly StageFlow[],
  after: readonly StageFlow[],
  stages: readonly BoardStage[],
  flows: readonly { id: string; name: string }[]
): string[] {
  const stageName = (id: string): string => stages.find((s) => s.id === id)?.name ?? id
  const flowName = (id: string): string => flows.find((f) => f.id === id)?.name ?? id
  const describe = (b: StageFlow): string =>
    `“${flowName(b.flowId)}” (${b.mode === 'on_enter' ? 'ao entrar' : 'manual'}${b.enabled ? '' : ', desligado'})`
  const out: string[] = []
  for (const b of after) {
    const old = before.find((x) => x.stageId === b.stageId)
    if (!old) out.push(`Coluna “${stageName(b.stageId)}” ganhou o fluxo ${describe(b)}`)
    else if (JSON.stringify(old) !== JSON.stringify(b)) {
      out.push(`Fluxo da coluna “${stageName(b.stageId)}”: ${describe(b)}`)
    }
  }
  for (const b of before) {
    if (!after.some((x) => x.stageId === b.stageId) && stages.some((s) => s.id === b.stageId)) {
      out.push(`Coluna “${stageName(b.stageId)}” ficou sem fluxo`)
    }
  }
  return out
}

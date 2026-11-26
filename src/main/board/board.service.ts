/**
 * Quadro kanban por projeto (Etapa 3A). Roda no main.
 *
 * - Configuração das etapas no ConfigStore (`boards[projectId]`); estado local, histórico e
 *   escritas pendentes no SQLite (BoardStore).
 * - Ao abrir/atualizar: reconcilia o estado local com o status atual de cada tarefa no Notion.
 * - Mover/bloquear: grava localmente na hora (otimista) e enfileira a escrita no Notion
 *   (NotionWriteQueue), que confirma, tenta de novo ou desfaz.
 */
import type { TaskEventDetailInput } from '../../shared/task-events'
import { WEEK_MS } from '../../shared/overview'
import type { StageFlow } from '../../shared/task-flow'
import { defaultRules, type AutomationRule } from '../../shared/automation'
import { upgradeAlvaFlows } from '../../shared/alva-templates'
import {
  diffFlow,
  toBoardStages,
  validateFlow,
  type FlowDraft,
  type ConfigEvent
} from '../../shared/flow'
import {
  BOARD_SETUP_MESSAGES,
  ORKIO_STAGE_PROPERTY_NAME,
  isReviewReturn,
  reconcile,
  stageMatchesStatus,
  suggestStages,
  validateStages,
  type BoardConfig,
  type BoardStage,
  type ReconcileTask,
  type StatusOption,
  type BoardCard,
  type BoardHistoryEntry,
  type BoardSaveInput,
  type BoardSyncEvent,
  type BoardView
} from '../../shared/board'
import type { OrkioConfig } from '../config/orkio-config'
import { projectFlows, withProjectFlows } from '../config/queries'
import {
  applyPropertyWrites,
  propertyWritesMatch,
  type PropertyWrite,
  type PropertyWrites
} from '../connectors/notion/notion.schema'
import type { CachedTasks } from '../notion/notion-workspace.service'
import { ConfigReadOnlyError, type ConfigStore } from '../storage/config-store'
import type { BoardStore, PendingWrite } from './board.store'
import { NotionWriteQueue, type WriteQueueDeps } from './write-queue'
import type { Tx } from '../db/database'
import type { NotionMapping, NotionPropertySummary } from '../../shared/notion'
import type { Result } from '../../shared/result'
import { isApiError } from '../net/http'
import { canReconnect, type NotionConnectionMethod } from '../../shared/notion-errors'

type Err = Extract<Result<never>, { ok: false }>['error']

export interface BoardNotion {
  boardTasks(
    projectId: string,
    options?: { force?: boolean }
  ): Promise<
    Result<CachedTasks & { fromCache: boolean; mapping: NotionMapping; tasksDataSourceId: string }>
  >
  statusOptions(): Promise<
    Result<{
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
  /**
   * Fila de escrita no Notion, criada aqui (as respostas dela voltam para este serviço). O token
   * fica no conector: `updatePage` só repassa.
   */
  writes: Omit<WriteQueueDeps, 'store' | 'onSynced' | 'onRejected' | 'onRetry'>
  onSync(event: BoardSyncEvent): void
  now?: () => Date
  newId?: () => string
  /** Depois de confirmar uma escrita, quanto tempo o Notion pode demorar a refletir (ms). */
  graceMs?: number
  /** "Quem" nos eventos de configuração (usuário do sistema operacional). */
  actor?: () => string
  /**
   * A etapa local de uma tarefa mudou (`enterStage`, `stage-entry.ts`). Sempre depois de gravar o
   * evento no histórico e dentro da mesma transação, qualquer que seja a origem; quem ouve deve
   * adiar o trabalho. `source` diz se foi entrada real (manual/automação) ou não.
   */
  enterStage(change: StageChange): void
}

export interface StageChange {
  projectId: string
  taskId: string
  from: string | null
  to: string | null
  source: 'manual' | 'automation' | 'notion' | 'rollback' | 'stage_removed'
  /** A automação devolveu de Revisado para Revisando (`isReviewReturn`): o fluxo da coluna não roda. */
  reviewReturn?: boolean
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
  stageNeedsOption: BOARD_SETUP_MESSAGES.stageNeedsOption,
  orkioPropertyExists: BOARD_SETUP_MESSAGES.orkioPropertyExists,
  orkioPropertyInvalid: BOARD_SETUP_MESSAGES.orkioPropertyInvalid,
  blockedPropertyInvalid: BOARD_SETUP_MESSAGES.blockedPropertyInvalid,
  pending: 'Aguardando o Notion…',
  retrying: 'Sem conexão com o Notion: a mudança será enviada assim que possível.'
} as const

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
  /** Escritas pendentes no Notion (persistidas no SQLite): `start`/`stop` ficam com a composição. */
  readonly writes: NotionWriteQueue
  /** Últimas tarefas lidas por projeto (mover offline usa os valores conhecidos do Notion). */
  private readonly snapshots = new Map<string, Snapshot>()
  /** Escritas confirmadas há pouco: o Notion pode ainda devolver o valor antigo na consulta. */
  private readonly recent = new Map<string, { properties: PropertyWrites; until: number }>()
  /** Última mensagem de falha transitória por tarefa (exibida no card). */
  private readonly retryMessages = new Map<string, string>()

  constructor(private readonly deps: BoardServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => `stage-${crypto.randomUUID()}`)
    this.graceMs = deps.graceMs ?? 30_000
    this.writes = new NotionWriteQueue({
      ...deps.writes,
      store: deps.store,
      onSynced: (w) => this.onSynced(w),
      onRejected: (w, e) => void this.onRejected(w, e),
      onRetry: (w, e) => this.onRetry(w, e)
    })
  }

  async get(projectId: string, options: { force?: boolean } = {}): Promise<Result<BoardView>> {
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

    const pending = new Set(this.deps.store.pendingForProject(projectId).map((w) => w.taskPageId))
    const nowMs = this.now().getTime()
    // "Atualizar" (force) é um pedido explícito pela verdade do Notion: sem janela de espera.
    if (force) this.recent.clear()
    for (const [taskId, recent] of this.recent) {
      if (recent.until < nowMs || propertyWritesMatch(data.values[taskId], recent.properties)) {
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
            toStage: d.stageId,
            detail: {}
          })
        } else if (d.from !== d.stageId) {
          this.deps.store.addEvent({
            taskPageId: d.taskId,
            projectId,
            at,
            kind: 'reconciled',
            fromStage: d.from,
            toStage: d.stageId,
            detail: { status: reconcileTasks.find((t) => t.id === d.taskId)?.status?.name ?? null }
          })
          this.deps.enterStage({
            projectId,
            taskId: d.taskId,
            from: d.from,
            to: d.stageId,
            source: 'notion'
          })
        }
        if (d.blockedChanged && d.from !== undefined) {
          this.deps.store.addEvent({
            taskPageId: d.taskId,
            projectId,
            at,
            kind: d.blocked ? 'blocked' : 'unblocked',
            source: 'notion',
            detail: {}
          })
        }
      }
    })

    const byId = new Map(decisions.map((d) => [d.taskId, d]))
    const pendingNow = new Set(
      this.deps.store.pendingForProject(projectId).map((w) => w.taskPageId)
    )
    const cards = data.tasks.map((t) =>
      this.toCard(t, {
        ...byId.get(t.id)!,
        automationPaused: states.get(t.id)?.automationPaused ?? false,
        pending: pendingNow.has(t.id)
      })
    )

    return {
      ...base,
      config,
      suggestion: null,
      issues: validated.issues,
      cards,
      pendingCount: pendingNow.size
    }
  }

  async move(projectId: string, taskId: string, stageId: string): Promise<Result<BoardCard>> {
    return this.wrap(async () => {
      const moved = this.deps.store.transaction(() =>
        this.applyMove(projectId, taskId, stageId, { source: 'manual' })
      )
      if (moved) void this.writes.kick()
      return this.card(projectId, taskId)
    })
  }

  /**
   * Mesmo caminho do movimento manual, para as automações (3B) e o orquestrador (8B): estado
   * local, evento com a chave de idempotência e a regra, e a escrita pendente no Notion. Pede a
   * transação de quem chama (`store.transaction((tx) => …)`): o movimento entra junto com o
   * snapshot e a chave. Devolve se moveu.
   */
  applyAutomationMove(
    _tx: Tx,
    projectId: string,
    taskId: string,
    stageId: string,
    event: { key: string; detail: TaskEventDetailInput<'moved'> }
  ): boolean {
    return this.applyMove(projectId, taskId, stageId, {
      source: 'automation',
      eventKey: event.key,
      detail: event.detail
    })
  }

  flushWrites(): void {
    void this.writes.kick()
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
      detail?: TaskEventDetailInput<'moved'>
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
    this.deps.store.addEvent({
      taskPageId: taskId,
      projectId,
      at,
      kind: 'moved',
      // Remoção de etapa é do Orkio: não conta como movimento manual (conflito das automações).
      source: options.stageRemoved ? 'system' : options.source,
      fromStage: before.stageId,
      toStage: stageId,
      detail: { ...options.detail, ...statusChange },
      eventKey: options.eventKey ?? null
    })
    this.syncDesired(projectId, taskId, board, snapshot, before)
    const source = options.stageRemoved ? 'stage_removed' : options.source
    this.deps.enterStage({
      projectId,
      taskId,
      from: before.stageId,
      to: stageId,
      source,
      ...(isReviewReturn(board.stages, before.stageId, stageId, source)
        ? { reviewReturn: true }
        : {})
    })
    return true
  }

  /** Pausa/retoma as automações de uma tarefa (registrado no histórico). */
  async setAutomationPaused(
    projectId: string,
    taskId: string,
    paused: boolean
  ): Promise<Result<BoardCard>> {
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
          detail: {}
        })
      })
      return this.card(projectId, taskId)
    })
  }

  async setBlocked(
    projectId: string,
    taskId: string,
    blocked: boolean
  ): Promise<Result<BoardCard>> {
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
          detail: {}
        })
        this.syncDesired(projectId, taskId, board, snapshot, before)
      })
      void this.writes.kick()
      return this.card(projectId, taskId)
    })
  }

  async history(projectId: string, taskId: string): Promise<Result<BoardHistoryEntry[]>> {
    return this.wrap(async () => {
      this.project(projectId)
      return this.deps.store.events(taskId)
    })
  }

  retryNow(): void {
    this.writes.retryAllNow()
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
    const properties: PropertyWrites = {}
    const stage = board.stages.find((s) => s.id === state.stageId)
    if (stage) {
      const status = task.status ? { id: task.status.id ?? null, name: task.status.name } : null
      if (!stageMatchesStatus(stage, status)) {
        const type = snapshot.statusType === 'select' ? 'select' : 'status'
        properties[snapshot.data.mapping.status.id] = { type, name: stage.notionStatus.name }
      }
      const orkio = board.orkioStageProperty
      if (orkio && !propertyWritesMatch(values, { [orkio.id]: orkioStage(stage.name) })) {
        properties[orkio.id] = orkioStage(stage.name)
      }
    }
    const blockedProp = board.blockedProperty
    if (blockedProp) {
      const current = values[blockedProp.id]
      const notionBlocked = current?.type === 'checkbox' ? current.checked : false
      if (notionBlocked !== state.blocked) {
        properties[blockedProp.id] = { type: 'checkbox', checked: state.blocked }
      }
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

  private onSynced(write: PendingWrite): void {
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
      toStage: state.stageId,
      detail: {}
    })
    this.deps.onSync({
      projectId: write.projectId,
      taskId: write.taskPageId,
      state: 'synced',
      stageId: state.stageId,
      blocked: state.blocked
    })
  }

  private async onRejected(
    write: PendingWrite,
    error: { code: string; message: string }
  ): Promise<void> {
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
        fromStage: before.stageId,
        toStage: write.rollback.stageId,
        detail: { code: error.code }
      })
      if (before.stageId !== write.rollback.stageId) {
        this.deps.enterStage({
          projectId: write.projectId,
          taskId: write.taskPageId,
          from: before.stageId,
          to: write.rollback.stageId,
          source: 'rollback'
        })
      }
    })
    const reconnect = canReconnect(error.code, await this.connectionMethod(), 'write')
    this.deps.onSync({
      projectId: write.projectId,
      taskId: write.taskPageId,
      state: 'failed',
      stageId: write.rollback.stageId,
      blocked: write.rollback.blocked,
      message: `O Notion recusou a mudança e o card voltou. ${error.message}`,
      ...(reconnect ? { canReconnect: true } : {})
    })
  }

  private onRetry(write: PendingWrite, error: { code: string; message: string }): void {
    // Transitório: só a conexão perdida/expirada se resolve reconectando (não depende do método).
    const auth = canReconnect(error.code, null, 'write')
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

  /**
   * Salva etapas + automações do editor de fluxo (Colunas e Automações). Mesmo caminho do
   * `save` (`commit`): mesma validação (`validateFlow`, a da tela), mesmas ligações e o mesmo
   * destino das tarefas das etapas removidas.
   */
  async saveFlow(projectId: string, draft: FlowDraft): Promise<Result<BoardView>> {
    return this.wrap(async () => {
      this.project(projectId)
      const previous = this.deps.config.get().boards[projectId]
      if (!previous) {
        throw new BoardError({ code: 'not_configured', message: BOARD_MESSAGES.noBoard })
      }
      const options = await this.statusOptionsOrThrow()
      const stages = this.checkedStages(projectId, draft, previous, options.options)
      return this.commit(projectId, previous, {
        stages,
        rules: draft.rules,
        removals: draft.removals,
        bindings: draft.bindings,
        orkioStageProperty: previous.orkioStageProperty,
        blockedProperty: previous.blockedProperty
      })
    })
  }

  /**
   * Cria o quadro (ou ajusta etapas, "Etapa Orkio" e "Bloqueada" pela tela do Notion). Valida como
   * o editor de fluxo; quadro novo ganha as regras padrão. As mudanças no Notion ("Etapa Orkio")
   * só acontecem depois da validação.
   */
  async save(projectId: string, input: BoardSaveInput): Promise<Result<BoardView>> {
    return this.wrap(async () => {
      this.project(projectId)
      const { options, properties } = await this.statusOptionsOrThrow()
      const previous = this.deps.config.get().boards[projectId]

      // Etapas mantidas guardam cor e papel (a tela do Notion não edita os dois).
      const draftStages = input.stages.map((s) => {
        const kept = s.id ? previous?.stages.find((p) => p.id === s.id) : undefined
        const option = options.find((o) => o.id === s.notionStatusId)
        const role = kept ? kept.role : s.role
        return {
          id: kept?.id ?? this.newId(),
          name: s.name,
          ...(kept?.color ? { color: kept.color } : {}),
          ...(role ? { role } : {}),
          notionStatusId: option?.id ?? null,
          ...(option ? {} : { missingStatusName: s.notionStatusId })
        }
      })
      // Regras salvas são conferidas contra as etapas novas; as padrão (quadro novo) são geradas
      // a partir delas (papel ausente = regra desligada).
      const stages = this.checkedStages(
        projectId,
        { stages: draftStages, rules: previous?.rules ?? [], removals: {} },
        previous,
        options
      )

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

      return this.commit(projectId, previous, {
        stages,
        rules: previous?.rules ?? defaultRules(stages).rules,
        removals: {},
        bindings: undefined,
        orkioStageProperty,
        blockedProperty
      })
    })
  }

  private async statusOptionsOrThrow(): Promise<{
    options: StatusOption[]
    properties: NotionPropertySummary[]
  }> {
    const r = await this.deps.notion.statusOptions()
    if (!r.ok) throw new BoardError(r.error)
    return { options: r.value.options, properties: r.value.properties }
  }

  /** A validação única (`validateFlow`, a mesma da tela): erros bloqueiam. */
  private checkedStages(
    projectId: string,
    draft: FlowDraft,
    previous: BoardConfig | undefined,
    options: readonly StatusOption[]
  ): BoardStage[] {
    const issues = validateFlow(draft, {
      statusOptions: options,
      savedStageIds: previous?.stages.map((s) => s.id) ?? [],
      taskCounts: this.deps.store.taskCounts(projectId)
    }).filter((i) => i.level === 'error')
    if (issues.length > 0) {
      throw new BoardError({ code: 'invalid', message: issues.map((i) => i.message).join(' ') })
    }
    return toBoardStages(draft.stages, options)
  }

  /**
   * Grava o quadro (já validado) e os efeitos de mudar etapas, iguais para quem salva:
   * - ligações etapa → fluxo (as do rascunho ou as salvas) pelo escritor único (`withProjectFlows`);
   * - quadro novo num projeto que já usa os modelos Alva: as etapas de revisão ganham os fluxos
   *   padrão (calculado dentro da escrita, sobre a config do momento);
   * - tarefas das etapas removidas vão para o destino escolhido (caminho do movimento manual);
   * - histórico de configuração.
   */
  private async commit(
    projectId: string,
    previous: BoardConfig | undefined,
    next: {
      stages: BoardStage[]
      rules: AutomationRule[]
      removals: FlowDraft['removals']
      bindings: StageFlow[] | undefined
      orkioStageProperty: BoardConfig['orkioStageProperty']
      blockedProperty: BoardConfig['blockedProperty']
    }
  ): Promise<BoardView> {
    const { stages } = next
    const board: BoardConfig = {
      stages,
      orkioStageProperty: next.orkioStageProperty,
      blockedProperty: next.blockedProperty,
      rules: next.rules,
      updatedAt: this.now().toISOString()
    }
    const removesStages = previous?.stages.some((p) => !stages.some((s) => s.id === p.id))
    if (removesStages && !this.snapshots.has(projectId)) await this.load(projectId, false)

    const before = projectFlows(this.deps.config.get(), projectId)
    let flowChanges: string[] = []
    try {
      await this.deps.config.update((c) => {
        const withBoard = { ...c, boards: { ...c.boards, [projectId]: board } }
        const current = projectFlows(c, projectId)
        let flows = { ...current, bindings: next.bindings ?? current.bindings }
        flowChanges = []
        if (!previous) {
          const alva = upgradeAlvaFlows(flows, stages)
          flows = alva.flows
          flowChanges = alva.changes
        }
        if (!c.flows[projectId] && !next.bindings && flowChanges.length === 0) return withBoard
        return withProjectFlows(withBoard, projectId, flows)
      })
    } catch (e) {
      throw new BoardError({
        code: 'storage',
        message: e instanceof ConfigReadOnlyError ? BOARD_MESSAGES.readOnly : BOARD_MESSAGES.storage
      })
    }
    const after = projectFlows(this.deps.config.get(), projectId)

    const changes = previous
      ? [
          ...diffFlow(previous, board),
          ...diffBindings(before.bindings, after.bindings, stages, after.flows)
        ]
      : [
          `Quadro criado com ${stages.length} etapas e ${board.rules.length} automações`,
          ...flowChanges
        ]
    let moved = 0
    this.deps.store.transaction(() => {
      for (const removed of previous?.stages ?? []) {
        if (stages.some((s) => s.id === removed.id)) continue
        const destination = next.removals[removed.id]
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
    if (moved > 0) void this.writes.kick()
    const propertyChanged = board.orkioStageProperty?.id !== previous?.orkioStageProperty?.id
    if (propertyChanged && board.orkioStageProperty) this.deps.notion.invalidateTasks(projectId)
    return this.load(projectId, propertyChanged && board.orkioStageProperty !== null)
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
    return this.toCard(task, {
      ...this.localState(projectId, taskId),
      automationPaused: this.deps.store.state(taskId)?.automationPaused ?? false,
      pending: this.deps.store.pending(taskId) !== null
    })
  }

  /** Card do quadro: a tarefa do Notion + o estado local (etapa, bloqueio, pausa, escrita na fila). */
  private toCard(
    task: CachedTasks['tasks'][number],
    local: { stageId: string | null; blocked: boolean; automationPaused: boolean; pending: boolean }
  ): BoardCard {
    return {
      taskId: task.id,
      displayId: task.displayId,
      title: task.title,
      url: task.url,
      status: task.status ? { name: task.status.name, color: task.status.color } : null,
      priority: task.priority,
      assignees: task.assignees,
      stageId: local.stageId,
      blocked: local.blocked,
      automationPaused: local.automationPaused,
      sync: local.pending
        ? { state: 'pending', message: this.retryMessages.get(task.id) ?? BOARD_MESSAGES.pending }
        : { state: 'synced' }
    }
  }

  private applyToSnapshot(write: PendingWrite): void {
    const snapshot = this.snapshots.get(write.projectId)
    if (!snapshot) return
    applyPropertyWrites((snapshot.data.values[write.taskPageId] ??= {}), write.properties)
    const task = snapshot.data.tasks.find((t) => t.id === write.taskPageId)
    const status = write.properties[snapshot.data.mapping.status.id]
    if (task && status && status.type !== 'checkbox') {
      task.status = { id: null, name: status.name, color: task.status?.color ?? 'default' }
    }
  }

  private connectionMethod(): Promise<NotionConnectionMethod> {
    return this.deps.notion.connectionMethod().catch(() => null)
  }

  private async wrap<T>(run: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await run() }
    } catch (e) {
      if (e instanceof BoardError) return { ok: false, error: e.info }
      if (isApiError(e, 'notion')) {
        const reconnect = canReconnect(e.code, await this.connectionMethod(), 'read')
        return {
          ok: false,
          error: { code: e.code, message: e.message, ...(reconnect ? { canReconnect: true } : {}) }
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

function orkioStage(name: string): PropertyWrite {
  return { type: 'select', name }
}

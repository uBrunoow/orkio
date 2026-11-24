/**
 * Tela "alva-flow" (Etapa 5B): pré-checagem (com cache), criação dos templates "Fluxo Alva" e
 * ligação nas colunas, coluna opcional "Planejando", limite de fluxos Alva em paralelo e o resumo
 * da task do Backlog.md para o painel.
 */
import {
  ALVA_MAX_PARALLEL,
  clampAlvaParallel,
  type AlvaPrecheck,
  type BacklogTaskDocument,
  type BacklogTaskInfo
} from '../../shared/alva'
import { ALVA_TEMPLATE_IDS, alvaTemplates } from '../../shared/alva-templates'
import { fromBoardStages, type FlowStageDraft } from '../../shared/flow'
import { queueStageOf, stageWithRole } from '../../shared/board'
import type { StageFlow } from '../../shared/task-flow'
import type { BoardService } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import type { OrkioConfig } from '../config/orkio-config'
import { errorName } from '../errors'
import type { ConfigStore } from '../storage/config-store'
import type { AlvaService } from './alva.service'
import type { Result } from '../../shared/result'
import { projectById, projectFlows, withProjectFlows } from '../config/queries'

export interface AlvaStatus {
  precheck: AlvaPrecheck | null
  /** Templates já criados neste projeto (ids presentes na config). */
  templates: { id: string; name: string; stageId: string | null; mode: StageFlow['mode'] | null }[]
  /** Colunas com algum fluxo ligado (para a tela não sugerir trocar a ligação de alguém). */
  boundStages: string[]
  maxParallel: number
}

export interface AlvaTemplateBindings {
  /** Etapa de cada template (null = sem coluna, roda à mão). */
  plan: string | null
  deliver: string | null
  /** "Alva: revisão publicada" (padrão na tela: coluna "Revisando"). */
  review: string | null
  reviewed: string | null
}

export class AlvaFlowsService {
  private readonly cache = new Map<string, AlvaPrecheck>()

  constructor(
    private readonly deps: {
      config: ConfigStore<OrkioConfig>
      store: BoardStore
      board: Pick<BoardService, 'saveFlow'>
      alva: AlvaService
      precheck(projectDir: string): Promise<AlvaPrecheck>
      /** O projeto usa Docker Compose? (leitura local, sem a pré-checagem). */
      usesDocker(projectDir: string): boolean
      actor(): string
      now?: () => Date
    }
  ) {}

  private project(projectId: string): { localPath: string } {
    const p = projectById(this.deps.config.get(), projectId)
    if (!p) throw new Error('not_found')
    return p
  }

  async precheck(projectId: string, force: boolean): Promise<AlvaPrecheck> {
    const cached = this.cache.get(projectId)
    if (cached && !force) return cached
    const result = await this.deps.precheck(this.project(projectId).localPath)
    this.cache.set(projectId, result)
    return result
  }

  /** Mensagem que impede um fluxo Alva de começar (ou null). */
  async blockReason(projectId: string): Promise<string | null> {
    const r = await this.precheck(projectId, false).catch(() => null)
    if (!r) return 'Não deu para verificar se o projeto está pronto para o alva-flow.'
    if (r.ready) return null
    const missing = r.items.filter((i) => i.state === 'missing').map((i) => i.label)
    return `O projeto não está pronto para o alva-flow: falta ${missing.join(', ')}. Veja a tela alva-flow do quadro.`
  }

  /**
   * Limite de fluxos Alva em paralelo: só quando o projeto usa Docker (portas). Olha os arquivos
   * de compose agora (não o cache da pré-checagem, vazio ao reabrir o app).
   */
  concurrencyLimit(projectId: string): number | null {
    const project = projectById(this.deps.config.get(), projectId)
    if (!project || !this.deps.usesDocker(project.localPath)) return null
    return this.maxParallel(projectId)
  }

  private maxParallel(projectId: string): number {
    return this.deps.config.get().flows[projectId]?.alva?.maxParallel ?? ALVA_MAX_PARALLEL.fallback
  }

  status(projectId: string): AlvaStatus {
    const pf = projectFlows(this.deps.config.get(), projectId)
    const ids = Object.values(ALVA_TEMPLATE_IDS) as string[]
    return {
      precheck: this.cache.get(projectId) ?? null,
      templates: pf.flows
        .filter((f) => ids.includes(f.id))
        .map((f) => {
          const b = pf.bindings.find((x) => x.flowId === f.id)
          return { id: f.id, name: f.name, stageId: b?.stageId ?? null, mode: b?.mode ?? null }
        }),
      boundStages: [...new Set(pf.bindings.map((b) => b.stageId))],
      maxParallel: this.maxParallel(projectId)
    }
  }

  /**
   * Cria (ou recria) os templates e liga nas colunas escolhidas (ao entrar). Fluxos com o
   * mesmo id são substituídos; os demais fluxos e ligações do projeto ficam.
   */
  async createTemplates(projectId: string, bindings: AlvaTemplateBindings): Promise<AlvaStatus> {
    this.project(projectId)
    const stages = this.deps.config.get().boards[projectId]?.stages ?? []
    const templates = alvaTemplates()
    const ids = new Set(templates.map((t) => t.id))
    const wanted: StageFlow[] = (
      [
        [bindings.plan, ALVA_TEMPLATE_IDS.plan],
        [bindings.deliver, ALVA_TEMPLATE_IDS.deliver],
        [bindings.review, ALVA_TEMPLATE_IDS.review],
        [bindings.reviewed, ALVA_TEMPLATE_IDS.reviewed]
      ] as const
    )
      .filter(([stageId]) => stageId && stages.some((s) => s.id === stageId))
      .map(([stageId, flowId]) => ({ stageId: stageId!, flowId, enabled: true, mode: 'on_enter' }))
    await this.deps.config.update((c) => {
      const pf = projectFlows(c, projectId)
      const takenStages = new Set(wanted.map((w) => w.stageId))
      return withProjectFlows(c, projectId, {
        ...pf,
        flows: [...pf.flows.filter((f) => !ids.has(f.id)), ...templates],
        bindings: [
          ...pf.bindings.filter((b) => !ids.has(b.flowId) && !takenStages.has(b.stageId)),
          ...wanted
        ]
      })
    })
    this.deps.store.addConfigEvent(
      projectId,
      (this.deps.now?.() ?? new Date()).toISOString(),
      this.deps.actor(),
      [
        `Fluxos Alva criados (${templates.map((t) => `“${t.name}”`).join(', ')})`,
        ...wanted.map(
          (w) =>
            `Coluna “${stages.find((s) => s.id === w.stageId)?.name ?? w.stageId}” ganhou o fluxo “${templates.find((t) => t.id === w.flowId)!.name}” (ao entrar)`
        )
      ]
    )
    return this.status(projectId)
  }

  /**
   * Coluna "Planejando" (papel `plan`) logo depois da coluna "A fazer" (`queueStageOf`), com o
   * status do Notion escolhido. Usa o mesmo caminho do "Salvar fluxo" (validação da 3C). Devolve
   * o id da etapa nova.
   */
  async addPlanningStage(projectId: string, notionStatusId: string): Promise<Result<string>> {
    const board = this.deps.config.get().boards[projectId]
    if (!board) return fail('no_board', 'Crie o quadro do projeto antes.')
    if (stageWithRole(board.stages, 'plan')) {
      return fail('exists', 'O quadro já tem uma coluna de planejamento.')
    }
    const id = `planejando-${Date.now().toString(36)}`
    const stages: FlowStageDraft[] = fromBoardStages(board.stages)
    const queue = queueStageOf(board)
    const after = stages.findIndex((s) => s.id === queue)
    stages.splice(after + 1, 0, {
      id,
      name: 'Planejando',
      color: 'purple',
      role: 'plan',
      notionStatusId
    })
    try {
      const r = await this.deps.board.saveFlow(projectId, {
        stages,
        rules: board.rules,
        removals: {}
      })
      return r.ok ? { ok: true, value: id } : fail(r.error.code, r.error.message)
    } catch (error) {
      console.error(`[orkio] coluna Planejando: ${errorName(error)}`)
      return fail('unexpected', 'Não foi possível criar a coluna. Tente de novo.')
    }
  }

  async setMaxParallel(projectId: string, value: number): Promise<AlvaStatus> {
    const n = clampAlvaParallel(value)
    await this.deps.config.update((c) =>
      withProjectFlows(c, projectId, { ...projectFlows(c, projectId), alva: { maxParallel: n } })
    )
    return this.status(projectId)
  }

  async taskSummary(
    projectId: string,
    taskId: string
  ): Promise<{
    linked: string | null
    task: BacklogTaskInfo | null
  }> {
    return {
      linked: this.deps.alva.getLink(taskId),
      task: await this.deps.alva.taskSummary(projectId, taskId)
    }
  }

  async taskDocument(
    projectId: string,
    taskId: string
  ): Promise<{ linked: string | null; doc: BacklogTaskDocument | null }> {
    return {
      linked: this.deps.alva.getLink(taskId),
      doc: await this.deps.alva.taskDocument(projectId, taskId)
    }
  }
}

function fail<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}

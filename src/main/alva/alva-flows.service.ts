/**
 * Tela "alva-flow" (Etapa 5B): pré-checagem (com cache), criação dos templates "Fluxo Alva" e
 * ligação nas colunas, coluna opcional "Planejando", limite de fluxos Alva em paralelo e o resumo
 * da task do Backlog.md para o painel.
 */
import type { AlvaPrecheck, BacklogTaskInfo } from '../../shared/alva'
import type { ClaudeResult } from '../../shared/agent-run'
import { ALVA_TEMPLATE_IDS, alvaTemplates } from '../../shared/alva-templates'
import type { FlowStageDraft } from '../../shared/flow'
import type { Flow, StageFlow } from '../../shared/task-flow'
import type { BoardService } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import type { OrkioConfig } from '../config/orkio-config'
import { errorName } from '../ipc/payload'
import type { ConfigStore } from '../storage/config-store'
import type { AlvaService } from './alva.service'

export interface AlvaStatus {
  precheck: AlvaPrecheck | null
  /** Templates já criados neste projeto (ids presentes na config). */
  templates: { id: string; name: string; stageId: string | null; mode: StageFlow['mode'] | null }[]
  maxParallel: number
}

export interface AlvaTemplateBindings {
  /** Etapa de cada template (null = sem coluna, roda à mão). */
  plan: string | null
  deliver: string | null
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
      actor(): string
      now?: () => Date
    }
  ) {}

  private project(projectId: string): { localPath: string } {
    const p = this.deps.config.get().projects.find((x) => x.id === projectId)
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

  /** Para o FlowRunner: mensagem que impede um fluxo Alva de começar (ou null). */
  async blockReason(projectId: string, flow: Flow): Promise<string | null> {
    if (!flow.tags?.includes('alva')) return null
    const r = await this.precheck(projectId, false).catch(() => null)
    if (!r) return 'Não deu para verificar se o projeto está pronto para o alva-flow.'
    if (r.ready) return null
    const missing = r.items.filter((i) => i.state === 'missing').map((i) => i.label)
    return `O projeto não está pronto para o alva-flow: falta ${missing.join(', ')}. Veja a tela alva-flow do quadro.`
  }

  /** Limite de fluxos Alva em paralelo: só quando o projeto usa Docker (portas). */
  concurrencyLimit(projectId: string, flow: Flow): number | null {
    if (!flow.tags?.includes('alva')) return null
    if (!this.cache.get(projectId)?.hasDocker) return null
    return this.deps.config.get().flows[projectId]?.alva?.maxParallel ?? 1
  }

  status(projectId: string): AlvaStatus {
    const pf = this.deps.config.get().flows[projectId] ?? { flows: [], bindings: [] }
    const ids = Object.values(ALVA_TEMPLATE_IDS) as string[]
    return {
      precheck: this.cache.get(projectId) ?? null,
      templates: pf.flows
        .filter((f) => ids.includes(f.id))
        .map((f) => {
          const b = pf.bindings.find((x) => x.flowId === f.id)
          return { id: f.id, name: f.name, stageId: b?.stageId ?? null, mode: b?.mode ?? null }
        }),
      maxParallel: pf.alva?.maxParallel ?? 1
    }
  }

  /**
   * Cria (ou recria) os 4 templates e liga nas colunas escolhidas (ao entrar). Fluxos com o
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
        [bindings.reviewed, ALVA_TEMPLATE_IDS.reviewed]
      ] as const
    )
      .filter(([stageId]) => stageId && stages.some((s) => s.id === stageId))
      .map(([stageId, flowId]) => ({ stageId: stageId!, flowId, enabled: true, mode: 'on_enter' }))
    await this.deps.config.update((c) => {
      const pf = c.flows[projectId] ?? { flows: [], bindings: [] }
      const takenStages = new Set(wanted.map((w) => w.stageId))
      return {
        ...c,
        flows: {
          ...c.flows,
          [projectId]: {
            ...pf,
            flows: [...pf.flows.filter((f) => !ids.has(f.id)), ...templates],
            bindings: [
              ...pf.bindings.filter((b) => !ids.has(b.flowId) && !takenStages.has(b.stageId)),
              ...wanted
            ]
          }
        }
      }
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
   * Coluna "Planejando" entre Prioridades e Em andamento, com o status do Notion escolhido.
   * Usa o mesmo caminho do "Salvar fluxo" (validação da 3C). Devolve o id da etapa nova.
   */
  async addPlanningStage(projectId: string, notionStatusId: string): Promise<ClaudeResult<string>> {
    const board = this.deps.config.get().boards[projectId]
    if (!board) return fail('no_board', 'Crie o quadro do projeto antes.')
    if (board.stages.some((s) => s.name.trim().toLowerCase() === 'planejando')) {
      return fail('exists', 'O quadro já tem a coluna “Planejando”.')
    }
    const id = `planejando-${Date.now().toString(36)}`
    const stages: FlowStageDraft[] = board.stages.map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.color ? { color: s.color } : {}),
      notionStatusId: s.notionStatus.id
    }))
    const after = board.stages.findIndex((s) => /prioridade/i.test(s.name))
    stages.splice(after >= 0 ? after + 1 : 0, 0, {
      id,
      name: 'Planejando',
      color: 'purple',
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
    const n = Math.min(4, Math.max(1, Math.floor(value)))
    await this.deps.config.update((c) => {
      const pf = c.flows[projectId] ?? { flows: [], bindings: [] }
      return { ...c, flows: { ...c.flows, [projectId]: { ...pf, alva: { maxParallel: n } } } }
    })
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
}

function fail<T>(code: string, message: string): ClaudeResult<T> {
  return { ok: false, error: { code, message } }
}

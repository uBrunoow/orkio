/**
 * Quadro kanban por projeto (Etapa 3A): etapas do Orkio, mapeamento para as opções do status do
 * Notion e reconciliação com o status atual das tarefas. Funções puras (main e renderer).
 */
import type { AutomationRule } from './automation'
import type { TaskEvent } from './task-events'
import type { NotionColor } from './notion'
import { normalizeLabel } from './text'

/**
 * Papel da etapa no trabalho, independente do nome (o usuário pode renomear à vontade). No
 * máximo uma etapa por papel. Quem precisa de "a coluna de revisão" ou "a etapa final" lê daqui:
 * regras padrão, ligações Alva, orquestrador, semana da visão geral e as telas.
 */
export const STAGE_ROLES = ['queue', 'plan', 'work', 'review', 'reviewed', 'done'] as const
export type StageRole = (typeof STAGE_ROLES)[number]

export const STAGE_ROLE_LABEL: Record<StageRole, string> = {
  queue: 'A fazer (fila da lista lateral)',
  plan: 'Planejamento',
  work: 'Trabalho',
  review: 'Em revisão',
  reviewed: 'Revisada',
  done: 'Concluída'
}

export function isStageRole(value: unknown): value is StageRole {
  return typeof value === 'string' && (STAGE_ROLES as readonly string[]).includes(value)
}

export interface BoardStage {
  id: string
  name: string
  /** Papel da etapa (`STAGE_ROLES`); sem papel = etapa comum. */
  role?: StageRole
  /** Posição (0..n-1). A ordem do array é a fonte da verdade; `order` é normalizado. */
  order: number
  /** Opção do status (mapeado na 2C) que esta etapa representa. O id sobrevive a renomeações. */
  notionStatus: { id: string | null; name: string }
  color?: NotionColor
}

export interface BoardConfig {
  stages: BoardStage[]
  /** Propriedade select "Etapa Orkio" (opcional) escrita junto com o status. */
  orkioStageProperty: { id: string; name: string } | null
  /** Checkbox do Notion sincronizada com "Bloqueada" (opcional). Sem ela, é só local. */
  blockedProperty: { id: string; name: string } | null
  /** Regras de automação (3B), avaliadas nesta ordem. Editor completo na 3C. */
  rules: AutomationRule[]
  updatedAt: string
}

/** Etapa com o papel, ou `null`. */
export function stageWithRole(
  stages: readonly { id: string; role?: StageRole | undefined }[],
  role: StageRole
): string | null {
  return stages.find((s) => s.role === role)?.id ?? null
}

/**
 * Coluna "A fazer" da lista lateral (as tarefas que esperam começar): a de papel `queue`; sem
 * ela, a primeira coluna do quadro.
 */
export function queueStageOf(
  config:
    | { stages: readonly { id: string; order: number; role?: StageRole | undefined }[] }
    | null
    | undefined
): string | null {
  const stages = config?.stages ?? []
  return (
    stageWithRole(stages, 'queue') ?? [...stages].sort((a, b) => a.order - b.order)[0]?.id ?? null
  )
}

/**
 * Ordem da prioridade do Notion (menor = antes). Reconhece nomes usuais pt/en e P0…P9; número puro
 * vale como está. Sem prioridade ou nome desconhecido vai depois de todas.
 */
export function priorityRank(name: string | null | undefined): number {
  if (!name) return 100
  const n = normalizeLabel(name)
  const p = /^p\s*(\d)\b/.exec(n) ?? /^(\d+)$/.exec(n)
  if (p) return Number(p[1])
  if (/urgent|critic|blocker|imediat|highest/.test(n)) return 0
  if (/alta|high|importante/.test(n)) return 1
  if (/media|medium|normal|moderad/.test(n)) return 2
  if (/baixa|low|minor/.test(n)) return 3
  if (/lowest|minima|someday|talvez/.test(n)) return 4
  return 50
}

export interface StatusOption {
  id: string
  name: string
  color: NotionColor
}

/** Template padrão: etapa (com o papel) → nome da opção de status no Notion. */
export const DEFAULT_STAGE_TEMPLATE: readonly {
  name: string
  notionStatus: string
  role: StageRole
}[] = [
  { name: 'Prioridades', notionStatus: 'Prioridades', role: 'queue' },
  { name: 'Em andamento', notionStatus: 'Em andamento', role: 'work' },
  { name: 'Revisando', notionStatus: 'Em andamento', role: 'review' },
  { name: 'Revisado', notionStatus: 'Em andamento', role: 'reviewed' },
  { name: 'Finalizada', notionStatus: 'Finalizadas', role: 'done' }
]

/** Acha a opção do Notion para um nome: exato normalizado, depois singular/plural simples. */
export function findOption(
  options: readonly StatusOption[],
  wanted: { id?: string | null; name: string }
): StatusOption | null {
  if (wanted.id) {
    const byId = options.find((o) => o.id === wanted.id)
    if (byId) return byId
  }
  const target = normalizeLabel(wanted.name)
  const exact = options.find((o) => normalizeLabel(o.name) === target)
  if (exact) return exact
  const stem = (s: string) => s.replace(/s$/, '')
  return options.find((o) => stem(normalizeLabel(o.name)) === stem(target)) ?? null
}

/**
 * Sugere as etapas a partir do template e das opções reais do status. Etapas cuja opção não
 * existe ficam com `notionStatus.id = null` e o nome do template (a validação aponta o problema).
 */
export function suggestStages(
  options: readonly StatusOption[],
  template = DEFAULT_STAGE_TEMPLATE,
  newId: (index: number) => string = (i) => `stage-${i + 1}`
): BoardStage[] {
  return template.map((t, i) => {
    const option = findOption(options, { name: t.notionStatus })
    return {
      id: newId(i),
      name: t.name,
      role: t.role,
      order: i,
      notionStatus: option
        ? { id: option.id, name: option.name }
        : { id: null, name: t.notionStatus },
      ...(option ? { color: option.color } : {})
    }
  })
}

export interface StageIssue {
  stageId: string
  level: 'error' | 'warning'
  message: string
}

/**
 * Confere as etapas contra as opções atuais: opção inexistente → erro (a etapa não pode ser
 * salva); opção renomeada (mesmo id) → aviso e nome atualizado. Também nomes vazios/repetidos.
 */
export function validateStages(
  stages: readonly BoardStage[],
  options: readonly StatusOption[]
): { stages: BoardStage[]; issues: StageIssue[] } {
  const issues: StageIssue[] = []
  const seen = new Set<string>()
  const updated = stages.map((stage, index): BoardStage => {
    const name = stage.name.trim()
    if (!name) {
      issues.push({ stageId: stage.id, level: 'error', message: 'Dê um nome à etapa.' })
    } else if (seen.has(normalizeLabel(name))) {
      issues.push({ stageId: stage.id, level: 'error', message: `Já existe uma etapa “${name}”.` })
    }
    seen.add(normalizeLabel(name))

    const option = stage.notionStatus.id
      ? options.find((o) => o.id === stage.notionStatus.id)
      : findOption(options, stage.notionStatus)
    if (!option) {
      issues.push({
        stageId: stage.id,
        level: 'error',
        message: `A opção “${stage.notionStatus.name}” não existe no status do Notion. Escolha outra ou crie-a no Notion.`
      })
      return { ...stage, name, order: index }
    }
    if (stage.notionStatus.id && option.name !== stage.notionStatus.name) {
      issues.push({
        stageId: stage.id,
        level: 'warning',
        message: `A opção “${stage.notionStatus.name}” foi renomeada para “${option.name}” no Notion.`
      })
    }
    return {
      ...stage,
      name,
      order: index,
      notionStatus: { id: option.id, name: option.name },
      color: stage.color ?? option.color
    }
  })
  if (stages.length === 0) {
    issues.push({
      stageId: '',
      level: 'error',
      message: 'O quadro precisa de pelo menos uma etapa.'
    })
  }
  return { stages: updated, issues }
}

// ---------- Reconciliação ----------

export interface ReconcileTask {
  id: string
  status: { id: string | null; name: string } | null
  /** Valor da propriedade "Etapa Orkio", se configurada. */
  orkioStage: string | null
  /** Checkbox "Bloqueada" no Notion, se mapeada (`null` = sem mapeamento/sem valor). */
  blocked: boolean | null
}

export interface LocalTaskState {
  stageId: string | null
  blocked: boolean
}

export type ReconcileReason = 'kept' | 'pending' | 'new' | 'moved_by_notion' | 'no_stage'

export interface ReconcileDecision {
  taskId: string
  stageId: string | null
  /** Etapa anterior (estado local), `undefined` se a tarefa é nova. */
  from: string | null | undefined
  reason: ReconcileReason
  /** Precisa gravar (estado novo ou mudou). */
  changed: boolean
  blocked: boolean
  blockedChanged: boolean
}

export function stageMatchesStatus(
  stage: BoardStage,
  status: { id: string | null; name: string } | null
): boolean {
  if (!status) return false
  if (stage.notionStatus.id && status.id) return stage.notionStatus.id === status.id
  return normalizeLabel(stage.notionStatus.name) === normalizeLabel(status.name)
}

/**
 * Decide a etapa de cada tarefa:
 * 1. escrita pendente (ou recém-escrita) → fica onde está (o local vale até sincronizar);
 * 2. status compatível com a etapa salva → fica;
 * 3. senão → "Etapa Orkio" (se apontar para uma etapa compatível) ou a primeira etapa com aquele
 *    status (evento source='notion'); tarefa nova idem;
 * 4. nenhuma etapa usa o status → `null` ("Sem etapa").
 */
export function reconcile(
  tasks: readonly ReconcileTask[],
  states: ReadonlyMap<string, LocalTaskState>,
  stages: readonly BoardStage[],
  pending: ReadonlySet<string> = new Set()
): ReconcileDecision[] {
  return tasks.map((task) => {
    const state = states.get(task.id)
    const notionBlocked = task.blocked
    const isPending = pending.has(task.id)
    const blocked = isPending || notionBlocked === null ? (state?.blocked ?? false) : notionBlocked
    const blockedChanged = state ? state.blocked !== blocked : blocked

    if (state && isPending) {
      return {
        taskId: task.id,
        stageId: state.stageId,
        from: state.stageId,
        reason: 'pending',
        changed: false,
        blocked,
        blockedChanged: false
      }
    }

    const current = state?.stageId ? stages.find((s) => s.id === state.stageId) : undefined
    if (state && current && stageMatchesStatus(current, task.status)) {
      return {
        taskId: task.id,
        stageId: current.id,
        from: state.stageId,
        reason: 'kept',
        changed: blockedChanged,
        blocked,
        blockedChanged
      }
    }

    const compatible = stages.filter((s) => stageMatchesStatus(s, task.status))
    const hinted = task.orkioStage
      ? compatible.find((s) => normalizeLabel(s.name) === normalizeLabel(task.orkioStage ?? ''))
      : undefined
    const target = hinted ?? compatible[0] ?? null
    const targetId = target?.id ?? null

    if (!state) {
      return {
        taskId: task.id,
        stageId: targetId,
        from: undefined,
        reason: target ? 'new' : 'no_stage',
        changed: true,
        blocked,
        blockedChanged
      }
    }
    const moved = state.stageId !== targetId
    return {
      taskId: task.id,
      stageId: targetId,
      from: state.stageId,
      reason: !target ? 'no_stage' : moved ? 'moved_by_notion' : 'kept',
      changed: moved || blockedChanged,
      blocked,
      blockedChanged
    }
  })
}

// ---------- Quadro (Etapa 3A) ----------

export type CardSyncState = 'synced' | 'pending' | 'failed'

export interface BoardCard {
  taskId: string
  displayId: string | null
  title: string
  url: string | null
  status: { name: string; color: NotionColor } | null
  priority: { name: string; color: NotionColor } | null
  assignees: string[]
  /** `null` = "Sem etapa" (nenhuma etapa usa o status atual do Notion). */
  stageId: string | null
  blocked: boolean
  /** Automações pausadas nesta tarefa (3B). */
  automationPaused: boolean
  sync: { state: CardSyncState; message?: string }
}

export interface BoardView {
  projectId: string
  projectName: string
  /** `null` = quadro ainda não criado: use `setup`. */
  config: BoardConfig | null
  /** Sugestão do template padrão contra as opções reais (só quando `config` é null). */
  suggestion: BoardStage[] | null
  /** Opções atuais do status mapeado na 2C. */
  statusOptions: StatusOption[]
  /** Propriedades do banco de Tarefas elegíveis para "Etapa Orkio" (select) e "Bloqueada" (checkbox). */
  selectProperties: { id: string; name: string; options: StatusOption[] }[]
  checkboxProperties: { id: string; name: string }[]
  issues: StageIssue[]
  cards: BoardCard[]
  truncated: boolean
  pendingCount: number
  fetchedAt: string
  /** Movimentos de cada automação (id da regra) nos últimos 7 dias. */
  ruleCountsWeek: Record<string, number>
}

export type OrkioStageChoice =
  | { mode: 'none' }
  | { mode: 'existing'; propertyId: string }
  /** Cria a propriedade select "Etapa Orkio" no banco de Tarefas (só com confirmação). */
  | { mode: 'create' }

/** Limites do editor de etapas (quadro e fluxo do projeto; o IPC confere os mesmos). */
export const STAGE_LIMITS = { stages: 30, name: 60 } as const

export interface BoardSaveInput {
  stages: { id: string | null; name: string; notionStatusId: string; role?: StageRole }[]
  orkioStage: OrkioStageChoice
  /** Autoriza adicionar ao select "Etapa Orkio" as opções que faltam. */
  addMissingOptions: boolean
  blockedPropertyId: string | null
}

export interface BoardSyncEvent {
  projectId: string
  taskId: string
  state: CardSyncState
  stageId: string | null
  blocked: boolean
  message?: string
  canReconnect?: boolean
}

/** Linha do histórico da tarefa: o evento tipado do catálogo (`shared/task-events.ts`). */
export type BoardHistoryEntry = TaskEvent & { id: number; at: string }

/**
 * Quadro kanban por projeto (Etapa 3A): etapas do Orkio, mapeamento para as opções do status do
 * Notion e reconciliação com o status atual das tarefas. Funções puras (main e renderer).
 */
import type { AutomationRule } from './automation'
import type { NotionColor } from './ipc-contract'

export interface BoardStage {
  id: string
  name: string
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

export interface StatusOption {
  id: string
  name: string
  color: NotionColor
}

/** Template padrão: etapa → nome da opção de status no Notion. */
export const DEFAULT_STAGE_TEMPLATE: readonly { name: string; notionStatus: string }[] = [
  { name: 'Prioridades', notionStatus: 'Prioridades' },
  { name: 'Em andamento', notionStatus: 'Em andamento' },
  { name: 'Revisando', notionStatus: 'Em andamento' },
  { name: 'Revisado', notionStatus: 'Em andamento' },
  { name: 'Finalizada', notionStatus: 'Finalizadas' }
]

export function normalizeOptionName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Acha a opção do Notion para um nome: exato normalizado, depois singular/plural simples. */
export function findOption(
  options: readonly StatusOption[],
  wanted: { id?: string | null; name: string }
): StatusOption | null {
  if (wanted.id) {
    const byId = options.find((o) => o.id === wanted.id)
    if (byId) return byId
  }
  const target = normalizeOptionName(wanted.name)
  const exact = options.find((o) => normalizeOptionName(o.name) === target)
  if (exact) return exact
  const stem = (s: string) => s.replace(/s$/, '')
  return options.find((o) => stem(normalizeOptionName(o.name)) === stem(target)) ?? null
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
    } else if (seen.has(normalizeOptionName(name))) {
      issues.push({ stageId: stage.id, level: 'error', message: `Já existe uma etapa “${name}”.` })
    }
    seen.add(normalizeOptionName(name))

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
  return normalizeOptionName(stage.notionStatus.name) === normalizeOptionName(status.name)
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
      ? compatible.find(
          (s) => normalizeOptionName(s.name) === normalizeOptionName(task.orkioStage ?? '')
        )
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

/** Mover para `to` só escreve o status no Notion se ele for diferente do status atual. */
export function moveNeedsStatusWrite(
  to: BoardStage,
  currentStatus: { id: string | null; name: string } | null
): boolean {
  return !stageMatchesStatus(to, currentStatus)
}

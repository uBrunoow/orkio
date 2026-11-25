import {
  STAGE_ROLES,
  STAGE_ROLE_COLUMN,
  stageWithRole,
  type BoardCard,
  type BoardStage,
  type StageRole
} from '../../../../shared/board'
import {
  matchesTaskFilter,
  needsAttention,
  type PersonalTask,
  type TaskFilter
} from '../../../../shared/task-lanes'
import type { TaskSignals } from '../../../../shared/task-signals'

/** Coluna "Sem etapa" (status do Notion que nenhuma etapa usa). Não aceita cards. */
export const NO_STAGE = '__sem-etapa__'
/** Coluna "Outras etapas" (etapa sem papel ou card sem etapa, no Quadro por papel). Não aceita cards. */
export const OTHER_STAGES = '__outras-etapas__'
export type BoardMode = 'single' | 'roles'
export const taskKey = (projectId: string, taskId: string): string => `${projectId}\u0000${taskId}`

export interface ProjectBoardInput {
  projectId: string
  projectName: string
  /** `null` = projeto ainda sem quadro (fica de fora das colunas). */
  stages: readonly BoardStage[] | null
  cards: readonly BoardCard[]
}

export interface BoardColumnDef {
  /** Id da etapa | `NO_STAGE` (single); papel | `OTHER_STAGES` (roles). */
  id: string
  name: string
  /** Tooltip do título. */
  hint: string
  /** Texto à direita ("Notion: X"); '' = nada. */
  aside: string
  /** Etapa da cor do ponto (roles: a 1ª etapa com o papel). */
  stage: BoardStage | null
  role: StageRole | null
}

export interface BoardEntry {
  /** `taskKey(projectId, card.taskId)`. */
  key: string
  projectId: string
  projectName: string
  card: BoardCard
  /** Etapas do projeto do card ("Mover para…"). */
  stages: readonly BoardStage[]
  columnId: string
  /** Nome da etapa no card: só em "Outras etapas" (etapa sem papel ou "Sem etapa"). */
  stageName: string | null
  personal: PersonalTask | null
  signals: TaskSignals | undefined
}

export function boardEntries(
  boards: readonly ProjectBoardInput[],
  mode: BoardMode,
  personal: ReadonlyMap<string, PersonalTask>,
  signals: ReadonlyMap<string, Record<string, TaskSignals>>
): BoardEntry[] {
  const out: BoardEntry[] = []
  for (const board of boards) {
    const stages = board.stages
    if (!stages) continue
    for (const card of board.cards) {
      const stage = card.stageId ? stages.find((s) => s.id === card.stageId) : undefined
      let columnId: string
      let stageName: string | null = null
      if (mode === 'single') {
        columnId = stage ? stage.id : NO_STAGE
      } else if (stage?.role) {
        columnId = stage.role
      } else {
        columnId = OTHER_STAGES
        stageName = stage ? stage.name : 'Sem etapa'
      }
      const key = taskKey(board.projectId, card.taskId)
      out.push({
        key,
        projectId: board.projectId,
        projectName: board.projectName,
        card,
        stages,
        columnId,
        stageName,
        personal: personal.get(key) ?? null,
        signals: signals.get(board.projectId)?.[card.taskId]
      })
    }
  }
  return out
}

export function singleBoardColumns(
  stages: readonly BoardStage[],
  entries: readonly BoardEntry[]
): BoardColumnDef[] {
  const columns: BoardColumnDef[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    hint: `Status no Notion: ${s.notionStatus.name}`,
    aside: `Notion: ${s.notionStatus.name}`,
    stage: s,
    role: null
  }))
  if (entries.some((e) => e.columnId === NO_STAGE)) {
    columns.push({
      id: NO_STAGE,
      name: 'Sem etapa',
      hint: 'Status do Notion que nenhuma etapa usa',
      aside: 'Sem etapa',
      stage: null,
      role: null
    })
  }
  return columns
}

export function roleBoardColumns(
  boards: readonly ProjectBoardInput[],
  entries: readonly BoardEntry[]
): BoardColumnDef[] {
  const columns: BoardColumnDef[] = []
  for (const role of STAGE_ROLES) {
    const withRole = boards.flatMap((b) => (b.stages ?? []).filter((s) => s.role === role))
    const first = withRole[0]
    if (!first) continue
    const names = [...new Set(withRole.map((s) => s.name))]
    columns.push({
      id: role,
      name: STAGE_ROLE_COLUMN[role],
      hint: `Etapas: ${names.join(', ')}`,
      aside: '',
      stage: first,
      role
    })
  }
  if (entries.some((e) => e.columnId === OTHER_STAGES)) {
    columns.push({
      id: OTHER_STAGES,
      name: 'Outras etapas',
      hint: 'Etapas sem papel; não dá para soltar aqui',
      aside: '',
      stage: null,
      role: null
    })
  }
  return columns
}

/** Etapa de destino do arraste no projeto do card; `null` = não dá para soltar ali. */
export function dropStageFor(entry: BoardEntry, columnId: string, mode: BoardMode): string | null {
  if (mode === 'single') return columnId === NO_STAGE ? null : columnId
  if (columnId === OTHER_STAGES) return null
  return stageWithRole(entry.stages, columnId as StageRole)
}

export function visibleEntries(
  entries: readonly BoardEntry[],
  f: { filter: TaskFilter; query: string; priority: string | null; onlyBlocked: boolean }
): BoardEntry[] {
  const q = f.query.trim().toLowerCase()
  return entries.filter(
    (e) =>
      matchesTaskFilter(e.personal, f.filter) &&
      (!q ||
        e.card.title.toLowerCase().includes(q) ||
        (e.card.displayId ?? '').toLowerCase().includes(q) ||
        e.projectName.toLowerCase().includes(q)) &&
      (!f.priority || e.card.priority?.name === f.priority) &&
      (!f.onlyBlocked || e.card.blocked)
  )
}

/** Entradas que pedem atenção, antes da busca: quem chama passa as entradas sem filtro. */
export function attentionCount(entries: readonly BoardEntry[]): number {
  return entries.filter((e) => e.personal && needsAttention(e.personal)).length
}

export type BoardSelection =
  { kind: 'one'; projectId: string | null } | { kind: 'many'; projectIds: string[] }

export function boardSelection(
  route: { projectIds?: readonly string[] | 'all' },
  linkedIds: readonly string[],
  currentId: string | null
): BoardSelection {
  const wanted = route.projectIds
  if (wanted !== undefined) {
    const ids =
      wanted === 'all'
        ? [...linkedIds]
        : [...new Set(wanted)].filter((id) => linkedIds.includes(id))
    if (ids.length >= 2) return { kind: 'many', projectIds: ids }
    if (ids.length === 1) return { kind: 'one', projectId: ids[0]! }
  }
  return { kind: 'one', projectId: currentId }
}

/**
 * v3 → v4 (3B): os quadros existentes ganham as regras padrão da época, com as etapas achadas pelo
 * nome (etapa ausente → regra desligada). Dados congelados: não use `defaultRules` de hoje.
 */
import { isRecord, rawStages, stageIdByName } from './frozen'

const V4_DEFAULT_RULES: readonly {
  id: string
  name: string
  trigger: string
  to: string
  from?: readonly string[]
  notify?: boolean
}[] = [
  {
    id: 'default-branch',
    name: 'Branch criada inicia a tarefa',
    trigger: 'branch.created',
    to: 'Em andamento',
    from: ['Prioridades']
  },
  {
    id: 'default-pr-opened',
    name: 'PR aberta vai para revisão',
    trigger: 'pr.opened',
    to: 'Revisando',
    from: ['Prioridades', 'Em andamento']
  },
  {
    id: 'default-pr-ready',
    name: 'PR pronta para review vai para revisão',
    trigger: 'pr.ready_for_review',
    to: 'Revisando',
    from: ['Prioridades', 'Em andamento']
  },
  {
    id: 'default-changes',
    name: 'Alterações pedidas: revisado',
    trigger: 'pr.changes_requested',
    to: 'Revisado',
    from: ['Revisando']
  },
  {
    id: 'default-comments',
    name: 'Comentários pendentes: revisado',
    trigger: 'pr.review_comments_unresolved',
    to: 'Revisado',
    from: ['Revisando']
  },
  {
    id: 'default-rerequest',
    name: 'Novo pedido de review volta para revisão',
    trigger: 'pr.review_requested',
    to: 'Revisando',
    from: ['Revisado']
  },
  { id: 'default-merged', name: 'Merge finaliza a tarefa', trigger: 'pr.merged', to: 'Finalizada' },
  {
    id: 'default-closed',
    name: 'PR fechada sem merge volta para andamento',
    trigger: 'pr.closed_unmerged',
    to: 'Em andamento',
    notify: true
  }
]

export function v4DefaultRules(stages: readonly { id: string; name: string }[]): unknown[] {
  return V4_DEFAULT_RULES.map((spec) => {
    const id = (name: string): string | null => stageIdByName(stages, name)
    const missing = [spec.to, ...(spec.from ?? [])].some((name) => !id(name))
    const from = spec.from?.map(id).filter((f): f is string => f !== null)
    return {
      id: spec.id,
      name: spec.name,
      enabled: !missing,
      trigger: spec.trigger,
      conditions: { notBlocked: true, ...(from ? { fromStages: from } : {}) },
      action: { type: 'move_to_stage', stageId: id(spec.to) ?? '' },
      ...(spec.notify ? { notify: true } : {})
    }
  })
}

export function migrateV3(data: Record<string, unknown>): Record<string, unknown> {
  const boards: Record<string, unknown> = {}
  const raw = isRecord(data['boards']) ? data['boards'] : {}
  for (const [projectId, board] of Object.entries(raw)) {
    const stages = rawStages(board)
    // Quadro sem etapas reconhecíveis fica como está (o validador decide).
    boards[projectId] =
      isRecord(board) && stages.length > 0 ? { ...board, rules: v4DefaultRules(stages) } : board
  }
  return { ...data, boards, automation: { paused: false } }
}

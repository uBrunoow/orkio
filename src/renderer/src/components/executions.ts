import type { ActivityItem } from '../../../shared/overview'
import type { StatusTone } from './StatusToken'

/** Uma execução de regra ou fluxo, montada da atividade do projeto (nenhum dado novo do main). */
export interface Execution {
  id: number
  at: string
  task: ActivityItem['task']
  outcome: string
  tone: StatusTone
  text: string
}

/** Resultado de um evento da regra na lista (`null` = o evento não conta como execução dela). */
function ruleOutcome(i: ActivityItem, ruleId: string): Pick<Execution, 'outcome' | 'tone'> | null {
  if (i.kind === 'moved') {
    return i.source === 'automation' && i.detail.ruleId === ruleId
      ? { outcome: 'Moveu a tarefa', tone: 'success' }
      : null
  }
  if (i.kind !== 'automation' || i.detail.ruleId !== ruleId) return null
  switch (i.detail.outcome) {
    case 'skipped':
      return { outcome: 'Ignorada', tone: 'neutral' }
    case 'notify':
      return { outcome: 'Notificou', tone: 'success' }
    default:
      return null
  }
}

/** Execuções de uma automação (pelo id da regra no evento). Mais novas primeiro, como a atividade. */
export function ruleExecutions(items: readonly ActivityItem[], ruleId: string): Execution[] {
  return items.flatMap((i) => {
    const result = ruleOutcome(i, ruleId)
    return result ? [{ id: i.id, at: i.at, task: i.task, text: i.text, ...result }] : []
  })
}

const FLOW_END = {
  done: { outcome: 'Concluído', tone: 'success' },
  rejected: { outcome: 'Recusado', tone: 'danger' },
  cancelled: { outcome: 'Cancelado', tone: 'neutral' }
} as const satisfies Record<string, Pick<Execution, 'outcome' | 'tone'>>

/**
 * Execuções de um fluxo: cada início com o fim da mesma execução (`flowRunId`). Sem fim ainda:
 * "Em andamento". Eventos gravados antes do `flowId` casam pelo nome do fluxo. Mais novas primeiro.
 */
export function flowExecutions(
  items: readonly ActivityItem[],
  flow: { id: string; name: string }
): Execution[] {
  return items.flatMap((start) => {
    if (start.kind !== 'flow_started') return []
    const { flowId, flow: name, flowRunId } = start.detail
    if (flowId !== undefined ? flowId !== flow.id : name !== flow.name) return []
    const end = items.find(
      (i) => i.kind === 'flow_finished' && flowRunId && i.detail.flowRunId === flowRunId
    )
    const result =
      end?.kind === 'flow_finished'
        ? FLOW_END[end.detail.result ?? 'done']
        : { outcome: 'Em andamento', tone: 'running' as const }
    return [
      {
        id: start.id,
        at: start.at,
        task: start.task,
        text: start.text,
        outcome: result.outcome,
        tone: result.tone
      }
    ]
  })
}

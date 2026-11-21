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

/**
 * Execuções de uma automação: os eventos de automação que citam a regra pelo nome
 * (`describeEvent` escreve `regra “Nome”`). Mais novas primeiro, como a atividade.
 */
export function ruleExecutions(items: readonly ActivityItem[], ruleName: string): Execution[] {
  const needle = `regra “${ruleName}”`
  return items
    .filter((i) => i.group === 'automation' && i.text.includes(needle))
    .map((i) => {
      const skipped = i.text.includes(' ignorada (')
      const notified = i.text.includes(': notificação (')
      return {
        id: i.id,
        at: i.at,
        task: i.task,
        text: i.text,
        outcome: skipped ? 'Ignorada' : notified ? 'Notificou' : 'Moveu a tarefa',
        tone: skipped ? 'neutral' : 'success'
      }
    })
}

const FLOW_END: Record<string, { outcome: string; tone: StatusTone }> = {
  'Fluxo concluído': { outcome: 'Concluído', tone: 'success' },
  'Fluxo encerrado (recusado)': { outcome: 'Recusado', tone: 'danger' },
  'Fluxo cancelado': { outcome: 'Cancelado', tone: 'neutral' }
}

/**
 * Execuções de um fluxo: cada "Fluxo iniciado: Nome" com o primeiro fim seguinte da mesma tarefa
 * (concluído, recusado ou cancelado). Sem fim ainda: "Em andamento". Mais novas primeiro.
 */
export function flowExecutions(items: readonly ActivityItem[], flowName: string): Execution[] {
  const flowItems = items.filter((i) => i.group === 'flow')
  const startText = `Fluxo iniciado: ${flowName}`
  const isStart = (i: ActivityItem): boolean =>
    i.text === startText || i.text.startsWith(`${startText} por `)
  return flowItems.filter(isStart).map((start) => {
    // Eventos da mesma tarefa depois do início, do mais antigo ao mais novo.
    const after = flowItems
      .filter((i) => i.task.taskId === start.task.taskId && i.id > start.id)
      .sort((a, b) => a.id - b.id)
    let end: ActivityItem | undefined
    for (const i of after) {
      if (i.text.startsWith('Fluxo iniciado: ')) break
      if (FLOW_END[i.text]) {
        end = i
        break
      }
    }
    const result = end ? FLOW_END[end.text]! : { outcome: 'Em andamento', tone: 'running' as const }
    return {
      id: start.id,
      at: start.at,
      task: start.task,
      text: start.text,
      outcome: result.outcome,
      tone: result.tone
    }
  })
}

import { describe, expect, it } from 'vitest'
import type { ActivityItem } from '../../../shared/overview'
import { activityGroup, type TaskEvent } from '../../../shared/task-events'
import { describeEvent } from '../../../shared/task-history'
import { flowExecutions, ruleExecutions } from './executions'

/** Item da atividade como o main monta: o evento tipado, com o texto do próprio histórico. */
function item(id: number, event: TaskEvent, taskId = 't1'): ActivityItem {
  return {
    ...event,
    id,
    at: `2026-11-20T10:${String(id).padStart(2, '0')}:00Z`,
    group: activityGroup(event)!,
    task: {
      projectId: 'p',
      projectName: 'p',
      taskId,
      displayId: taskId.toUpperCase(),
      title: null
    },
    text: describeEvent(event, (s) => s ?? 'Sem etapa'),
    link: null,
    section: 'history'
  }
}
const base = { fromStage: 'a', toStage: 'b' }
const rule = (
  kind: 'moved' | 'automation',
  ruleId: string,
  over: Partial<{ outcome: 'skipped' | 'notify' | 'move'; ruleName: string }> = {}
): TaskEvent => ({
  ...base,
  kind,
  source: 'automation',
  detail: { event: 'pr.merged', ruleId, ruleName: over.ruleName ?? 'Merge finaliza', ...over }
})
const flow = (kind: 'flow_started' | 'flow_finished', detail: Record<string, unknown>): TaskEvent =>
  ({ ...base, kind, source: 'system', detail }) as TaskEvent

describe('ruleExecutions', () => {
  it('pega os eventos da regra pelo id (não pelo texto), com o resultado', () => {
    const items = [
      item(4, rule('moved', 'r1')),
      item(3, rule('automation', 'r1', { outcome: 'skipped' })),
      item(2, rule('automation', 'r1', { outcome: 'notify' })),
      // Já estava na etapa: não é execução.
      item(1, rule('automation', 'r1', { outcome: 'move' })),
      // Mesmo nome, outra regra.
      item(0, rule('moved', 'r2'))
    ]
    expect(ruleExecutions(items, 'r1').map((e) => [e.id, e.outcome, e.tone])).toEqual([
      [4, 'Moveu a tarefa', 'success'],
      [3, 'Ignorada', 'neutral'],
      [2, 'Notificou', 'success']
    ])
  })

  it('movimento manual não conta como execução', () => {
    const manual: TaskEvent = { ...base, kind: 'moved', source: 'manual', detail: { ruleId: 'r1' } }
    expect(ruleExecutions([item(1, manual)], 'r1')).toEqual([])
  })
})

describe('flowExecutions', () => {
  const entregar = { id: 'entregar', name: 'Entregar' }

  it('pareia cada início com o fim da mesma execução do fluxo', () => {
    const items = [
      item(
        9,
        flow('flow_started', { flowRunId: 'r3', flowId: 'entregar', flow: 'Entregar' }),
        't2'
      ),
      item(8, flow('flow_finished', { flowRunId: 'r2', result: 'rejected' })),
      item(
        7,
        flow('flow_started', {
          flowRunId: 'r2',
          flowId: 'entregar',
          flow: 'Entregar',
          agent: 'Ana'
        })
      ),
      item(6, flow('flow_finished', { flowRunId: 'r1', result: 'done' })),
      item(5, flow('flow_finished', { flowRunId: 'r0', result: 'cancelled' })),
      item(4, flow('flow_started', { flowRunId: 'r1', flowId: 'entregar', flow: 'Entregar' })),
      item(3, flow('flow_started', { flowRunId: 'r0', flowId: 'outro', flow: 'Outro' }))
    ]
    expect(flowExecutions(items, entregar).map((e) => [e.id, e.outcome, e.tone])).toEqual([
      [9, 'Em andamento', 'running'],
      [7, 'Recusado', 'danger'],
      [4, 'Concluído', 'success']
    ])
  })

  it('pelo id do fluxo: renomear não perde as execuções; sem id (eventos antigos), pelo nome exato', () => {
    const items = [
      item(3, flow('flow_started', { flowRunId: 'r2', flowId: 'entregar', flow: 'Nome antigo' })),
      item(2, flow('flow_started', { flowRunId: 'r1', flow: 'Entregar rápido' })),
      item(1, flow('flow_started', { flowRunId: 'r0', flow: 'Entregar' }))
    ]
    expect(flowExecutions(items, entregar).map((e) => e.id)).toEqual([3, 1])
  })
})

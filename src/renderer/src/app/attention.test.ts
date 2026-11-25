import { describe, expect, it } from 'vitest'
import { finishedItems } from './attention'
import type { ActivityItem } from '../../../shared/overview'

let id = 0
function item(
  taskId: string,
  at: string,
  kind: 'run_finished' | 'flow_finished' | 'moved',
  result: 'done' | 'cancelled' = 'done'
): ActivityItem {
  const base = {
    id: ++id,
    at,
    group: 'flow' as const,
    task: { projectId: 'p', projectName: 'P', taskId, displayId: taskId, title: taskId },
    text: kind,
    link: null,
    section: 'flow' as const,
    source: 'system' as const,
    fromStage: null,
    toStage: null
  }
  if (kind === 'run_finished') {
    return { ...base, kind, detail: { runId: 'r', files: 1, costUsd: null } } as ActivityItem
  }
  if (kind === 'flow_finished') {
    return { ...base, kind, detail: { flowRunId: 'f', result } } as ActivityItem
  }
  return { ...base, kind, detail: {} } as unknown as ActivityItem
}

describe('finishedItems', () => {
  it('fluxos concluídos e execuções que terminaram; um por tarefa, o mais recente primeiro', () => {
    const list = finishedItems(
      [
        item('A', '2026-11-24T10:00:00Z', 'run_finished'),
        item('A', '2026-11-24T11:00:00Z', 'flow_finished'),
        item('B', '2026-11-24T12:00:00Z', 'flow_finished', 'cancelled'),
        item('C', '2026-11-24T09:00:00Z', 'run_finished'),
        item('D', '2026-11-24T13:00:00Z', 'moved')
      ],
      null
    )
    expect(list.map((i) => [i.task.taskId, i.text])).toEqual([
      ['A', 'flow_finished'],
      ['C', 'run_finished']
    ])
  })

  it('"Limpar" esconde o que terminou antes; o limite corta a lista', () => {
    const items = [
      item('A', '2026-11-24T10:00:00Z', 'run_finished'),
      item('B', '2026-11-24T12:00:00Z', 'run_finished')
    ]
    expect(finishedItems(items, '2026-11-24T11:00:00Z').map((i) => i.task.taskId)).toEqual(['B'])
    expect(finishedItems(items, '2026-11-24T12:00:00Z')).toEqual([])
    expect(finishedItems(items, null, 1)).toHaveLength(1)
  })
})

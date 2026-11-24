import { describe, expect, it } from 'vitest'
import type { OverviewSnapshot, RunningItem, WaitingItem } from '../../../../shared/overview'
import { activityByTask } from './task-activity'

const task = (taskId: string, projectId = 'p1') => ({
  projectId,
  projectName: 'P',
  taskId,
  displayId: null,
  title: null
})
const waiting = (key: string, taskId: string, since: string, projectId = 'p1'): WaitingItem => ({
  key,
  kind: 'gate',
  task: task(taskId, projectId),
  what: key,
  since,
  section: 'flow'
})
const running = (key: string, taskId: string): RunningItem => ({
  key,
  kind: 'flow',
  task: task(taskId),
  label: key,
  state: 'running',
  startedAt: '2026-01-01',
  section: 'flow'
})
const snapshot = (w: WaitingItem[], r: RunningItem[]): OverviewSnapshot =>
  ({ waiting: w, running: r }) as unknown as OverviewSnapshot

describe('activityByTask', () => {
  it('por tarefa do projeto: a espera mais antiga e o primeiro que roda', () => {
    const map = activityByTask(
      snapshot(
        [
          waiting('nova', 't1', '2026-01-02'),
          waiting('velha', 't1', '2026-01-01'),
          waiting('outro-projeto', 't9', '2026-01-01', 'p2')
        ],
        [running('r1', 't1'), running('r2', 't2'), running('r3', 't2')]
      ),
      'p1'
    )
    expect([...map.keys()]).toEqual(['t1', 't2'])
    expect(map.get('t1')).toMatchObject({ waiting: { key: 'velha' }, running: { key: 'r1' } })
    expect(map.get('t2')).toMatchObject({ waiting: null, running: { key: 'r2' } })
  })

  it('sem visão ainda: nada', () => {
    expect(activityByTask(null, 'p1').size).toBe(0)
  })
})

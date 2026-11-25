import { describe, expect, it } from 'vitest'
import type { OverviewTask, RunningItem, WaitingItem } from './overview'
import type { TaskPullRequest } from './task-signals'
import { deriveLane, filterTasks, groupByLane, prChips, type LaneInput } from './task-lanes'

const NOW = '2026-11-24T12:00:00.000Z'
const TASK: OverviewTask = {
  projectId: 'p1',
  projectName: 'Orkio',
  taskId: 't1',
  displayId: 'ORK-1',
  title: 'Exportar CSV'
}

function pr(over: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 7,
    title: 'feat',
    url: 'https://github.com/acme/app/pull/7',
    state: 'open',
    merged: false,
    headRef: 'feat/ORK-1',
    updatedAt: '2026-11-24T10:00:00.000Z',
    reviewDecision: null,
    unresolvedComments: 0,
    checks: 'success',
    ...over
  }
}

function input(over: Partial<LaneInput> = {}): LaneInput {
  return {
    task: TASK,
    waiting: null,
    running: null,
    pr: null,
    stageRole: null,
    lastFlow: null,
    now: NOW,
    ...over
  }
}

const WAITING: WaitingItem = {
  key: 'flow:1',
  kind: 'gate',
  task: TASK,
  what: 'Aprovar a spec',
  since: '2026-11-24T11:00:00.000Z',
  section: 'flow'
}
const RUNNING: RunningItem = {
  key: 'flow:1',
  kind: 'flow',
  task: TASK,
  label: 'Rodar uma vez · Implementar',
  state: 'running',
  startedAt: '2026-11-24T11:30:00.000Z',
  section: 'flow'
}

describe('kanban derivado', () => {
  it('ordem: espera você → trabalhando → fila → PR → concluído', () => {
    expect(deriveLane(input({ waiting: WAITING, running: RUNNING, pr: pr() }))).toMatchObject({
      lane: 'needs_you',
      what: 'Aprovar a spec'
    })
    expect(deriveLane(input({ running: RUNNING, pr: pr() }))).toMatchObject({ lane: 'working' })
    expect(
      deriveLane(input({ running: { ...RUNNING, state: 'queued', label: 'X · aguardando vaga' } }))
    ).toMatchObject({ lane: 'waiting', what: 'X · aguardando vaga' })
  })

  it('PR: CI rodando e rascunho aguardam; aberta fica em revisão com chips', () => {
    expect(deriveLane(input({ pr: pr({ checks: 'pending' }) }))).toMatchObject({
      lane: 'waiting',
      what: 'CI rodando na PR #7'
    })
    expect(deriveLane(input({ pr: pr({ state: 'draft' }) }))).toMatchObject({ lane: 'waiting' })
    expect(
      deriveLane(
        input({
          pr: pr({ checks: 'failure', reviewDecision: 'changes_requested', conflict: true })
        })
      )
    ).toMatchObject({ lane: 'in_review', chips: ['ci_failed', 'changes_requested', 'conflict'] })
    expect(prChips(pr({ reviewDecision: 'approved' }))).toEqual(['ready'])
    expect(prChips(pr())).toEqual(['awaiting_review'])
    expect(prChips(pr({ unresolvedComments: 2 }))).toEqual(['comments'])
  })

  it('concluído: PR mergeada na semana ou fluxo terminado; antigo some', () => {
    expect(
      deriveLane(input({ pr: pr({ state: 'merged', merged: true, closedAt: NOW }) }))
    ).toMatchObject({ lane: 'done', what: 'PR #7 mergeada' })
    expect(
      deriveLane(input({ lastFlow: { result: 'done', endedAt: '2026-11-23T12:00:00.000Z' } }))
    ).toMatchObject({ lane: 'done', what: 'Fluxo concluído' })
    expect(
      deriveLane(input({ lastFlow: { result: 'done', endedAt: '2026-10-01T12:00:00.000Z' } }))
    ).toBeNull()
    expect(deriveLane(input())).toBeNull()
  })

  it('filtros: em andamento tira o concluído; atenção = espera você ou PR com problema', () => {
    const tasks = [
      deriveLane(input({ waiting: WAITING }))!,
      deriveLane(input({ task: { ...TASK, taskId: 't2' }, pr: pr({ checks: 'failure' }) }))!,
      deriveLane(input({ task: { ...TASK, taskId: 't3' }, pr: pr() }))!,
      deriveLane(
        input({ task: { ...TASK, taskId: 't4' }, lastFlow: { result: 'done', endedAt: NOW } })
      )!
    ]
    expect(filterTasks(tasks, 'all')).toHaveLength(4)
    expect(filterTasks(tasks, 'active').map((t) => t.task.taskId)).toEqual(['t1', 't2', 't3'])
    expect(filterTasks(tasks, 'attention').map((t) => t.task.taskId)).toEqual(['t1', 't2'])
    expect(filterTasks(tasks, 'all', 'csv')).toHaveLength(4)
    expect(filterTasks(tasks, 'all', 'nada')).toHaveLength(0)
    const lanes = groupByLane(tasks)
    expect(lanes.needs_you).toHaveLength(1)
    expect(lanes.in_review).toHaveLength(2)
    expect(lanes.done).toHaveLength(1)
  })
})

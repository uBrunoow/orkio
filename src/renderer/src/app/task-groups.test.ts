import { describe, expect, it } from 'vitest'
import type {
  OverviewSnapshot,
  OverviewTask,
  RunningItem,
  WaitingItem
} from '../../../shared/overview'
import { taskGroups, TODO_LIMIT } from './task-groups'
import type { BoardCard, BoardView } from '../../../shared/board'

const task = (taskId: string, projectId = 'p1'): OverviewTask => ({
  projectId,
  projectName: 'Orkio',
  taskId,
  displayId: taskId.toUpperCase(),
  title: `Título ${taskId}`
})

const waiting = (taskId: string, since: string, what: string, projectId = 'p1'): WaitingItem => ({
  key: `${taskId}-${since}`,
  kind: 'gate',
  task: task(taskId, projectId),
  what,
  since,
  section: 'flow'
})

const running = (taskId: string): RunningItem => ({
  key: `run-${taskId}`,
  kind: 'flow',
  task: task(taskId),
  label: 'Alva · /alva-flow:implement',
  state: 'running',
  startedAt: '2026-11-23T10:00:00Z',
  section: 'flow'
})

const snapshot = (w: WaitingItem[], r: RunningItem[] = []): OverviewSnapshot =>
  ({ waiting: w, running: r, prs: [], projects: [], notices: [] }) as unknown as OverviewSnapshot

const card = (taskId: string, stageId: string, priority: string | null = null): BoardCard => ({
  taskId,
  displayId: taskId.toUpperCase(),
  title: `Card ${taskId}`,
  url: null,
  status: null,
  priority: priority ? { name: priority, color: 'default' } : null,
  assignees: [],
  stageId,
  blocked: false,
  automationPaused: false,
  sync: { state: 'synced' }
})

const board = (cards: BoardCard[], queueStageId?: string): BoardView =>
  ({
    projectId: 'p1',
    config: {
      ...(queueStageId ? { queueStageId } : {}),
      stages: [
        { id: 's2', name: 'Em andamento', order: 1, notionStatus: { id: null, name: 'b' } },
        { id: 's1', name: 'Prioridades', order: 0, notionStatus: { id: null, name: 'a' } }
      ],
      orkioStageProperty: null,
      blockedProperty: null,
      rules: [],
      updatedAt: ''
    },
    cards
  }) as unknown as BoardView

describe('taskGroups', () => {
  it('agrupa por projeto e não repete tarefa', () => {
    const g = taskGroups({
      projectId: 'p1',
      snapshot: snapshot(
        [
          waiting('t1', '2026-11-23T10:05:00Z', 'Responder pergunta'),
          waiting('t1', '2026-11-23T10:00:00Z', 'Aprovar plano'),
          waiting('t9', '2026-11-23T09:00:00Z', 'Outro projeto', 'p2')
        ],
        [running('t1'), running('t2')]
      ),
      board: null
    })
    expect(g.waiting).toHaveLength(1)
    expect(g.waiting[0]).toMatchObject({
      taskId: 't1',
      detail: 'Aprovar plano',
      tone: 'warning',
      section: 'flow'
    })
    expect(g.running.map((t) => t.taskId)).toEqual(['t2'])
    expect(g.running[0]?.tone).toBe('running')
  })

  it('a fazer vem da coluna "A fazer" do quadro, por prioridade e antiguidade', () => {
    const g = taskGroups({
      projectId: 'p1',
      snapshot: null,
      board: board(
        [
          card('novaAlta', 's2', 'Alta'),
          card('velhaAlta', 's2', 'Alta'),
          card('velhaBaixa', 's2', 'Baixa'),
          card('outraEtapa', 's1')
        ],
        's2'
      )
    })
    expect(g.todo.map((t) => t.taskId)).toEqual(['velhaAlta', 'novaAlta', 'velhaBaixa'])
    expect(g.todo[0]).toMatchObject({ title: 'Card velhaAlta', tone: 'neutral' })
  })

  it('sem coluna "A fazer" escolhida no quadro usa a primeira etapa', () => {
    const g = taskGroups({
      projectId: 'p1',
      snapshot: null,
      board: board([card('a', 's2'), card('b', 's1')])
    })
    expect(g.todo.map((t) => t.taskId)).toEqual(['b'])
  })

  it('a fazer não repete quem está esperando ou rodando', () => {
    const g = taskGroups({
      projectId: 'p1',
      snapshot: snapshot([waiting('a', '2026-11-23T10:00:00Z', 'x')], [running('b')]),
      board: board([card('a', 's1'), card('b', 's1'), card('c', 's1')])
    })
    expect(g.todo.map((t) => t.taskId)).toEqual(['c'])
  })

  it('corta em 8 e conta o total', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(`t${i}`, 's1'))
    const g = taskGroups({
      projectId: 'p1',
      snapshot: null,
      board: board(cards)
    })
    expect(TODO_LIMIT).toBe(8)
    expect(g.todo).toHaveLength(8)
    expect(g.todoTotal).toBe(10)
  })

  it('sem quadro e sem snapshot não quebra', () => {
    expect(taskGroups({ projectId: 'p1', snapshot: null, board: null })).toEqual({
      waiting: [],
      running: [],
      todo: [],
      todoTotal: 0
    })
  })

  it('título cai para o do quadro e depois para o genérico', () => {
    const w = waiting('a', '2026-11-23T10:00:00Z', 'x')
    const noTitle = { ...w, task: { ...w.task, title: null } }
    const w2 = waiting('z', '2026-11-23T10:00:00Z', 'y')
    const g = taskGroups({
      projectId: 'p1',
      snapshot: snapshot([noTitle, { ...w2, task: { ...w2.task, title: null } }]),
      board: board([card('a', 's1')])
    })
    expect(g.waiting.map((t) => t.title)).toEqual(['Card a', 'Tarefa do Notion'])
  })
})

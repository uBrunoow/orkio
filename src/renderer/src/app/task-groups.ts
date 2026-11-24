/**
 * Lista lateral (reestruturação): as tarefas do projeto atual agrupadas pelo que fazer agora.
 * Puro: junta o que a Visão geral (6D) já calcula (esperando você, rodando) com o quadro (a fazer).
 */

import type { OverviewSnapshot, OverviewTask, TaskSection } from '../../../shared/overview'
import type { StatusTone } from '../components/StatusToken'
import { priorityRank, queueStageOf, type BoardCard, type BoardView } from '../../../shared/board'

export interface SidebarTask {
  taskId: string
  displayId: string | null
  title: string
  tone: StatusTone
  detail: string | null
  section?: TaskSection
}

export interface TaskGroups {
  waiting: SidebarTask[]
  running: SidebarTask[]
  todo: SidebarTask[]
  /** Quantas tarefas há na fila (antes do corte em `TODO_LIMIT`). */
  todoTotal: number
}

export const TODO_LIMIT = 8

const FALLBACK_TITLE = 'Tarefa do Notion'

export function taskGroups(input: {
  projectId: string
  snapshot: OverviewSnapshot | null
  board: BoardView | null
}): TaskGroups {
  const { projectId, snapshot, board } = input
  const cards = new Map<string, BoardCard>((board?.cards ?? []).map((c) => [c.taskId, c]))
  const title = (t: OverviewTask): string => t.title ?? cards.get(t.taskId)?.title ?? FALLBACK_TITLE

  const oldestWaiting = new Map<string, OverviewSnapshot['waiting'][number]>()
  for (const item of snapshot?.waiting ?? []) {
    if (item.task.projectId !== projectId) continue
    const current = oldestWaiting.get(item.task.taskId)
    if (!current || item.since < current.since) oldestWaiting.set(item.task.taskId, item)
  }
  const waiting: SidebarTask[] = [...oldestWaiting.values()]
    .sort((a, b) => a.since.localeCompare(b.since))
    .map((item) => ({
      taskId: item.task.taskId,
      displayId: item.task.displayId,
      title: title(item.task),
      tone: 'warning',
      detail: item.what,
      section: item.section
    }))

  const seen = new Set(oldestWaiting.keys())
  const running: SidebarTask[] = []
  for (const item of snapshot?.running ?? []) {
    if (item.task.projectId !== projectId || seen.has(item.task.taskId)) continue
    seen.add(item.task.taskId)
    running.push({
      taskId: item.task.taskId,
      displayId: item.task.displayId,
      title: title(item.task),
      tone: 'running',
      detail: item.label,
      section: item.section
    })
  }

  const queue = queueStageOf(board?.config)
  // Os cards vêm do Notion por `created_time` desc: índice maior = tarefa mais antiga.
  const inQueue = (board?.cards ?? [])
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => queue !== null && card.stageId === queue && !seen.has(card.taskId))
    .sort(
      (a, b) =>
        priorityRank(a.card.priority?.name) - priorityRank(b.card.priority?.name) ||
        b.index - a.index
    )
  const todo: SidebarTask[] = inQueue.slice(0, TODO_LIMIT).map(({ card }) => ({
    taskId: card.taskId,
    displayId: card.displayId,
    title: card.title || FALLBACK_TITLE,
    tone: 'neutral',
    detail: null
  }))

  return { waiting, running, todo, todoTotal: inQueue.length }
}

/**
 * O que cada tarefa de um projeto tem agora na Visão geral: o que espera você (o item mais antigo)
 * e o que está rodando (o primeiro da lista do main). Puro; uma regra só para o card do quadro, a
 * lista lateral e a tela Agentes.
 */
import type { OverviewSnapshot, RunningItem, WaitingItem } from '../../../../shared/overview'

export interface TaskActivity {
  waiting: WaitingItem | null
  running: RunningItem | null
}

export const NO_ACTIVITY: TaskActivity = { waiting: null, running: null }

/** Por tarefa do projeto; a ordem é a dos itens (quem espera primeiro, depois só rodando). */
export function activityByTask(
  snapshot: OverviewSnapshot | null,
  projectId: string
): Map<string, TaskActivity> {
  const map = new Map<string, TaskActivity>()
  for (const item of snapshot?.waiting ?? []) {
    if (item.task.projectId !== projectId) continue
    const current = map.get(item.task.taskId)
    if (!current?.waiting || item.since < current.waiting.since) {
      map.set(item.task.taskId, { waiting: item, running: null })
    }
  }
  for (const item of snapshot?.running ?? []) {
    if (item.task.projectId !== projectId) continue
    const current = map.get(item.task.taskId) ?? NO_ACTIVITY
    if (!current.running) map.set(item.task.taskId, { ...current, running: item })
  }
  return map
}

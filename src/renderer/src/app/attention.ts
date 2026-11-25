/**
 * Sino de atenção (Fase 0): "Precisa de você" vem da regra única de "esperando você"
 * (`OverviewSnapshot.waiting` + PRs com atenção); "Concluído" = o que terminou desde o último
 * "Limpar" (fluxo concluído ou execução do Claude Code que terminou), uma linha por tarefa. Puro.
 */
import type { ActivityItem, OverviewTask, TaskSection } from '../../../shared/overview'

export interface FinishedItem {
  key: string
  task: OverviewTask
  text: string
  at: string
  section: TaskSection
}

export const FINISHED_LIMIT = 8

function isFinished(item: ActivityItem): boolean {
  if (item.kind === 'run_finished') return true
  return item.kind === 'flow_finished' && item.detail.result === 'done'
}

/** O que terminou depois de `clearedAt` (ISO), o mais recente primeiro, um por tarefa. */
export function finishedItems(
  items: readonly ActivityItem[],
  clearedAt: string | null,
  limit = FINISHED_LIMIT
): FinishedItem[] {
  const since = clearedAt ? Date.parse(clearedAt) : Number.NEGATIVE_INFINITY
  const byTask = new Map<string, FinishedItem>()
  const sorted = [...items].filter(isFinished).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  for (const item of sorted) {
    if (!(Date.parse(item.at) > since)) continue
    const key = `${item.task.projectId}:${item.task.taskId}`
    if (byTask.has(key)) continue
    byTask.set(key, { key, task: item.task, text: item.text, at: item.at, section: item.section })
  }
  return [...byTask.values()].slice(0, limit)
}

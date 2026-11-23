/**
 * Primeira tela ao abrir o app: sem projeto, os Primeiros passos; com algo esperando você no
 * projeto atual, essa tarefa; senão o Quadro.
 */
import type { Route } from './routes'
import type { TaskGroups } from './task-groups'

export function initialRoute(input: {
  projectCount: number
  currentProjectId: string | null
  groups: TaskGroups | null
}): Route {
  if (input.projectCount === 0) return { name: 'setup' }
  const first = input.groups?.waiting[0]
  if (first && input.currentProjectId) {
    return {
      name: 'task',
      projectId: input.currentProjectId,
      taskId: first.taskId,
      ...(first.section ? { section: first.section } : {})
    }
  }
  return { name: 'board' }
}

import { useCallback, useMemo } from 'react'
import { useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import { taskKey } from './board-model'
import type { PersonalTask } from '../../../../shared/task-lanes'

/**
 * Situação de cada tarefa (raia) por `taskKey(projeto, tarefa)`, da fonte
 * compartilhada `personalTasks` (`app/sources.tsx`). Sem dados ainda, o mapa vem vazio.
 */
export function usePersonalTasks(): {
  byKey: ReadonlyMap<string, PersonalTask>
  reload(): Promise<void>
} {
  const { personalTasks } = useSources()
  const value = useSource(personalTasks, '').value
  const byKey = useMemo(
    () => new Map((value?.tasks ?? []).map((t) => [taskKey(t.task.projectId, t.task.taskId), t])),
    [value]
  )
  const reload = useCallback(() => personalTasks.reload(''), [personalTasks])
  return { byKey, reload }
}

import { createContext, useContext, useEffect, useState } from 'react'
import type { TaskFlowActivity } from '../../../../shared/task-flow'

export type ActiveFlows = Record<string, TaskFlowActivity>

const ActiveFlowsContext = createContext<ActiveFlows>({})

export const ActiveFlowsProvider = ActiveFlowsContext.Provider

export function useTaskFlowState(taskId: string): TaskFlowActivity | null {
  return useContext(ActiveFlowsContext)[taskId] ?? null
}

export function useActiveFlows(projectId: string): ActiveFlows {
  const [active, setActive] = useState<ActiveFlows>({})
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    void window.orkio.taskFlows.active(projectId).then((a) => {
      if (alive) setActive(a)
    })
    return () => {
      alive = false
    }
  }, [projectId, tick])
  useEffect(
    () =>
      window.orkio.taskFlows.onChanged((e) => {
        if (e.projectId === projectId) setTick((n) => n + 1)
      }),
    [projectId]
  )
  return active
}

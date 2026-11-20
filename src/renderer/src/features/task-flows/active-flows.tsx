import { createContext, useContext, useEffect, useState } from 'react'

export type ActiveFlows = Record<string, 'running' | 'needs_you'>

const ActiveFlowsContext = createContext<ActiveFlows>({})

export const ActiveFlowsProvider = ActiveFlowsContext.Provider

/** Estado do fluxo de uma tarefa para o card (indicador discreto). */
export function useTaskFlowState(taskId: string): 'running' | 'needs_you' | null {
  return useContext(ActiveFlowsContext)[taskId] ?? null
}

/** Tarefas do projeto com fluxo ativo; atualiza a cada mudança de fluxo. */
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

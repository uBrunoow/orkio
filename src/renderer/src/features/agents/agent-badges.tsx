import { createContext, useContext, useEffect, useState } from 'react'
import type { AgentBadge } from '../../../../shared/agent'

export type AgentBadges = Record<string, AgentBadge>

const AgentBadgesContext = createContext<AgentBadges>({})

export const AgentBadgesProvider = AgentBadgesContext.Provider

/** Agente da tarefa (avatar no card). */
export function useAgentBadge(taskId: string): AgentBadge | null {
  return useContext(AgentBadgesContext)[taskId] ?? null
}

/** Agentes das tarefas do projeto; recarrega quando agentes, atribuições ou fluxos mudam. */
export function useAgentBadges(projectId: string): AgentBadges {
  const [badges, setBadges] = useState<AgentBadges>({})
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    void window.orkio.agents
      .badges(projectId)
      .then((b) => {
        if (alive) setBadges(b)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projectId, tick])
  useEffect(
    () =>
      window.orkio.agents.onChanged((e) => {
        if (e.projectId === projectId) setTick((n) => n + 1)
      }),
    [projectId]
  )
  return badges
}

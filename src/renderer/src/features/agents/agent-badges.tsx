import { createContext, useContext } from 'react'
import { useIpcResource } from '../../lib/ipc'
import type { AgentBadge } from '../../../../shared/agent'

export type AgentBadges = Record<string, AgentBadge>

const AgentBadgesContext = createContext<AgentBadges>({})

export const AgentBadgesProvider = AgentBadgesContext.Provider

/** Agente da tarefa (avatar no card). */
export function useAgentBadge(taskId: string): AgentBadge | null {
  return useContext(AgentBadgesContext)[taskId] ?? null
}

const NONE: AgentBadges = {}

/** Agentes das tarefas do projeto (`null` = nenhum); recarrega quando agentes ou atribuições mudam. */
export function useAgentBadges(projectId: string | null): AgentBadges {
  return (
    useIpcResource(projectId, (id) => window.orkio.agents.badges(id), {
      subscribe: (reload, id) =>
        window.orkio.agents.onChanged((e) => {
          if (e.projectId === id) reload()
        })
    }).value ?? NONE
  )
}

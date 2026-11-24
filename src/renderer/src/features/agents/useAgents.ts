import { unwrap, useIpcResource, type IpcResource } from '../../lib/ipc'
import type { AgentsState } from '../../../../shared/agent'
import type { OrchestratorState } from '../../../../shared/orchestrator'

/** Relê quando os agentes ou as atribuições do projeto mudam (evento do main). */
const onAgentsChanged = (reload: () => void, projectId: string): (() => void) =>
  window.orkio.agents.onChanged((e) => {
    if (e.projectId === projectId) reload()
  })

/** Perfis, regras e etapas dos agentes do projeto (`null` = nenhum projeto). */
export function useAgentsState(projectId: string | null): IpcResource<AgentsState> {
  return useIpcResource(projectId, (id) => window.orkio.agents.list(id).then(unwrap), {
    subscribe: onAgentsChanged
  })
}

export function useOrchestrator(projectId: string | null): IpcResource<OrchestratorState> {
  return useIpcResource(projectId, (id) => window.orkio.agents.orchestrator(id).then(unwrap), {
    subscribe: onAgentsChanged
  })
}

/** Nomes dos comandos do catálogo do Claude Code no projeto (sem tarefa: a pasta do projeto). */
export function useCommandNames(projectId: string | null): string[] {
  return (
    useIpcResource(projectId, async (id) => {
      const groups = unwrap(await window.orkio.claude.catalog(id, null))
      return [...new Set(groups.flatMap((g) => g.commands.map((c) => c.name)))]
    }).value ?? []
  )
}

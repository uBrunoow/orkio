/**
 * Dados das telas Segredos e Servidores MCP: o Vault (só metadados), os servidores MCP e os agentes
 * que podem receber segredos/servidores.
 */
import { useMemo } from 'react'
import { unwrap, useIpcResource, type IpcResource } from '../../lib/ipc'
import { useAgentsState } from '../agents/useAgents'
import { agentKey, isUsableAgent, type AgentColor } from '../../../../shared/agent'
import { BUILTIN_AGENTS } from '../../../../shared/agent-presets'
import type { VaultView } from '../../../../shared/vault'
import type { McpView } from '../../../../shared/mcp'

export function useVault(): IpcResource<VaultView> {
  return useIpcResource('', () => window.orkio.vault.get(), { refreshOnFocus: true })
}

export function useMcp(): IpcResource<McpView> {
  return useIpcResource('', () => window.orkio.mcp.get().then(unwrap), { refreshOnFocus: true })
}

export interface AgentOption {
  key: string
  name: string
  /** Para o rosto (`AgentAvatar`); ausente = amarelo. */
  color?: AgentColor
  description?: string
}

/**
 * Agentes para "quem pode usar"/"só estes agentes": os do projeto (repositório, este computador e
 * embutidos) ou, sem projeto, só os embutidos.
 */
export function useAgentOptions(projectId: string | null): AgentOption[] {
  const state = useAgentsState(projectId)
  const agents = state.value?.agents
  return useMemo(() => {
    const out: AgentOption[] = (agents ?? []).filter(isUsableAgent).map((a) => ({
      key: a.key,
      name: a.profile.name,
      color: a.profile.color,
      description: a.profile.description
    }))
    for (const b of BUILTIN_AGENTS) {
      const key = agentKey('builtin', b.id)
      if (!out.some((o) => o.key === key)) {
        out.push({ key, name: b.name, color: b.color, description: b.description })
      }
    }
    return out
  }, [agents])
}

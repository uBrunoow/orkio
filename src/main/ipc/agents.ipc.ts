import type { ORKIO_API } from '../../shared/ipc/api'
import type { AgentMemoryStore } from '../agents/agent-memory.store'
import { AgentError, type AgentsService } from '../agents/agents.service'
import type { OrchestratorService } from '../orchestrator/orchestrator.service'
import type { Impl } from './register'

export function agentsHandlers(
  agents: AgentsService,
  orchestrator: OrchestratorService,
  memory: AgentMemoryStore
): Impl<typeof ORKIO_API.agents> {
  /** Memória só de agente que existe para o projeto (nada de pasta para chave inventada). */
  const known = async (projectId: string, key: string): Promise<void> => {
    const view = await agents.get(projectId, key)
    if (!view) throw new AgentError('not_found', 'Esse agente não existe mais.')
  }
  return {
    list: async (projectId) => ({ ok: true, value: await agents.list(projectId) }),
    save: async (input) => {
      await agents.save(input)
      return { ok: true, value: await agents.list(input.projectId) }
    },
    approve: async (projectId, key, hash) => {
      await agents.approve(projectId, key, hash)
      return { ok: true, value: await agents.list(projectId) }
    },
    assign: async (projectId, taskId, key) => {
      await agents.assign(projectId, taskId, key)
      return { ok: true, value: null }
    },
    setRules: async (projectId, rules) => ({
      ok: true,
      value: await agents.setRules(projectId, rules)
    }),
    badges: (projectId) => agents.badges(projectId),
    orchestrator: async (projectId) => ({ ok: true, value: await orchestrator.state(projectId) }),
    saveOrchestrator: async (projectId, config) => ({
      ok: true,
      value: await orchestrator.save(projectId, config)
    }),
    runOrchestrator: async (projectId) => {
      await orchestrator.tick(projectId)
      return { ok: true, value: await orchestrator.state(projectId) }
    },
    memory: async (projectId, key) => {
      await known(projectId, key)
      return { ok: true, value: await memory.read(key, projectId) }
    },
    addMemory: async (projectId, key, digest, note) => {
      await known(projectId, key)
      return { ok: true, value: await memory.add(key, projectId, note, digest) }
    },
    editMemory: async (projectId, key, digest, id, note) => {
      await known(projectId, key)
      return { ok: true, value: await memory.edit(key, projectId, digest, id, note) }
    },
    changeMemory: async (projectId, key, digest, id, action) => {
      await known(projectId, key)
      const value =
        action === 'remove'
          ? await memory.remove(key, projectId, digest, id)
          : action === 'archive'
            ? await memory.archive(key, projectId, digest, id)
            : await memory.unarchive(key, projectId, digest, id)
      return { ok: true, value }
    },
    rollbackMemory: async (projectId, key, digest, snapshotId) => {
      await known(projectId, key)
      return { ok: true, value: await memory.rollback(key, projectId, digest, snapshotId) }
    }
  }
}

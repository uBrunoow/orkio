import type { ORKIO_API } from '../../shared/ipc/api'
import type { AgentsService } from '../agents/agents.service'
import type { OrchestratorService } from '../orchestrator/orchestrator.service'
import type { Impl } from './register'

export function agentsHandlers(
  agents: AgentsService,
  orchestrator: OrchestratorService
): Impl<typeof ORKIO_API.agents> {
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
    }
  }
}

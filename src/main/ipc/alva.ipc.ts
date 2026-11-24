import type { ORKIO_API } from '../../shared/ipc/api'
import type { AlvaFlowsService } from '../alva/alva-flows.service'
import type { Impl } from './register'

/** alva-flow (5B): pré-checagem, templates, coluna "Planejando", limite e a task do Backlog.md. */
export function alvaHandlers(service: AlvaFlowsService): Impl<typeof ORKIO_API.alva> {
  return {
    precheck: async (projectId, options) => ({
      ok: true,
      value: await service.precheck(projectId, options.force)
    }),
    status: (projectId) => ({ ok: true, value: service.status(projectId) }),
    createTemplates: async (projectId, bindings) => ({
      ok: true,
      value: await service.createTemplates(projectId, bindings)
    }),
    addPlanningStage: (projectId, statusId) => service.addPlanningStage(projectId, statusId),
    setMaxParallel: async (projectId, value) => ({
      ok: true,
      value: await service.setMaxParallel(projectId, value)
    }),
    taskSummary: async (projectId, taskId) => ({
      ok: true,
      value: await service.taskSummary(projectId, taskId)
    }),
    taskDocument: async (projectId, taskId) => ({
      ok: true,
      value: await service.taskDocument(projectId, taskId)
    })
  }
}

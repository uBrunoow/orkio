import type { ORKIO_API } from '../../shared/ipc/api'
import type { TaskSetupService } from '../task-setup/task-setup.service'
import type { Impl } from './register'

/**
 * "Como deve rodar?" (Fase 1). `TaskSetupError` (travado, inválido, revisor = autor) vira
 * `Result` de falha no registro do IPC; o resto vira a mensagem genérica do grupo.
 */
export function taskSetupHandlers(service: TaskSetupService): Impl<typeof ORKIO_API.taskSetup> {
  return {
    get: async (projectId, taskId) => ({ ok: true, value: await service.view(projectId, taskId) }),
    save: async (projectId, taskId, setup) => ({
      ok: true,
      value: await service.save(projectId, taskId, setup)
    }),
    columns: (projectId) => ({ ok: true, value: service.columns(projectId) }),
    saveColumn: async (projectId, stageId, setup) => ({
      ok: true,
      value: await service.saveColumn(projectId, stageId, setup)
    })
  }
}

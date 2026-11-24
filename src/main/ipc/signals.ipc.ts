import type { ORKIO_API } from '../../shared/ipc/api'
import type { ReviewThreadsService } from '../signals/review-threads'
import type { TaskSignalsService } from '../signals/task-signals.service'
import type { Impl } from './register'

/** Sinais das tarefas (branches/PRs) e threads da PR. O renderer manda só ids. */
export function signalsHandlers(
  service: Pick<TaskSignalsService, 'get'>,
  reviews: Pick<ReviewThreadsService, 'get'>
): Impl<typeof ORKIO_API.signals> {
  return {
    get: (projectId, options) => service.get(projectId, options),
    // O main acha a PR pelos sinais em cache; o texto vem do GraphQL.
    reviewThreads: async (projectId, taskId, options) => {
      const r = await reviews.get(projectId, taskId, options.force)
      return r.ok
        ? { ok: true, value: r.value }
        : { ok: false, error: { code: r.code, message: r.message } }
    }
  }
}

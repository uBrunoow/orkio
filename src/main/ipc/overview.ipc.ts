import type { ORKIO_API } from '../../shared/ipc/api'
import type { OverviewService } from '../overview/overview.service'
import type { Impl } from './register'

/** Visão geral (6D): leituras locais; o renderer manda no máximo um filtro. */
export function overviewHandlers(
  service: Pick<OverviewService, 'snapshot' | 'refresh' | 'activity'>
): Impl<typeof ORKIO_API.overview> {
  return {
    get: async () => ({ ok: true, value: await service.snapshot() }),
    refresh: async () => ({ ok: true, value: await service.refresh() }),
    activity: (query) => ({ ok: true, value: service.activity(query) })
  }
}

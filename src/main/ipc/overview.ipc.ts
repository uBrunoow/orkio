import type { IpcMain } from 'electron'
import { IPC_CHANNELS, type OverviewResult } from '../../shared/ipc-contract'
import { ACTIVITY_KINDS, type ActivityGroup, type ActivityQuery } from '../../shared/overview'
import type { OverviewService } from '../overview/overview.service'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const GENERIC: OverviewResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Não foi possível montar a Visão geral. Tente atualizar.' }
}
const UNAVAILABLE: OverviewResult<never> = {
  ok: false,
  error: {
    code: 'db_unavailable',
    message:
      'O banco local não pôde ser aberto (pode ser de uma versão mais nova do Orkio). A Visão geral fica indisponível.'
  }
}
const INVALID: OverviewResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Filtro inválido. Atualize a tela e tente de novo.' }
}

/** Filtro da atividade vindo do renderer (`unknown`): só campos conhecidos e válidos. */
export function parseActivityQuery(value: unknown): ActivityQuery | null {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const query: ActivityQuery = {}
  if (v['projectId'] !== undefined && v['projectId'] !== null) {
    if (!isId(v['projectId'])) return null
    query.projectId = v['projectId']
  }
  if (v['group'] !== undefined && v['group'] !== null) {
    if (typeof v['group'] !== 'string' || !(v['group'] in ACTIVITY_KINDS)) return null
    query.group = v['group'] as ActivityGroup
  }
  if (v['beforeId'] !== undefined && v['beforeId'] !== null) {
    if (!Number.isSafeInteger(v['beforeId']) || (v['beforeId'] as number) < 1) return null
    query.beforeId = v['beforeId'] as number
  }
  if (v['limit'] !== undefined) {
    if (!Number.isSafeInteger(v['limit']) || (v['limit'] as number) < 1) return null
    query.limit = Math.min(v['limit'] as number, 200)
  }
  return query
}

/** Visão geral (6D): leituras locais; o renderer manda no máximo um filtro. */
export function registerOverviewIpc(
  ipc: Pick<IpcMain, 'handle'>,
  /** `null` = banco local indisponível (versão futura/ilegível): responde com a explicação. */
  service: Pick<OverviewService, 'snapshot' | 'refresh' | 'activity'> | null,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.overview
  function guarded<T>(
    channel: string,
    run: (...args: unknown[]) => Promise<OverviewResult<T>>
  ): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return GENERIC
      }
    })
  }
  guarded(ch.get, async () =>
    service ? { ok: true, value: await service.snapshot() } : UNAVAILABLE
  )
  guarded(ch.refresh, async () =>
    service ? { ok: true, value: await service.refresh() } : UNAVAILABLE
  )
  guarded(ch.activity, async (raw) => {
    if (!service) return UNAVAILABLE
    const query = parseActivityQuery(raw)
    return query ? { ok: true, value: service.activity(query) } : INVALID
  })
}

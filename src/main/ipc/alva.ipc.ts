import type { IpcMain } from 'electron'
import type { ClaudeResult } from '../../shared/agent-run'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { AlvaFlowsService } from '../alva/alva-flows.service'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const INVALID: ClaudeResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Pedido inválido. Atualize a tela e tente de novo.' }
}
const GENERIC: ClaudeResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado. Tente novamente.' }
}
const stageOrNull = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && v.length <= 100)

export function registerAlvaIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: AlvaFlowsService,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.alva
  function guarded<T>(
    channel: string,
    run: (...args: unknown[]) => Promise<ClaudeResult<T>>
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
  const ok = <T>(value: T): ClaudeResult<T> => ({ ok: true, value })

  guarded(ch.precheck, async (projectId, force) =>
    isId(projectId) ? ok(await service.precheck(projectId, force === true)) : INVALID
  )
  guarded(ch.status, async (projectId) =>
    isId(projectId) ? ok(service.status(projectId)) : INVALID
  )
  guarded(ch.createTemplates, async (projectId, b) => {
    const v = b as Record<string, unknown> | null
    return isId(projectId) &&
      v &&
      stageOrNull(v['plan']) &&
      stageOrNull(v['deliver']) &&
      stageOrNull(v['reviewed'])
      ? ok(
          await service.createTemplates(projectId, {
            plan: v['plan'] as string | null,
            deliver: v['deliver'] as string | null,
            reviewed: v['reviewed'] as string | null
          })
        )
      : INVALID
  })
  guarded(ch.addPlanningStage, async (projectId, statusId) =>
    isId(projectId) && typeof statusId === 'string' && statusId.length <= 100
      ? service.addPlanningStage(projectId, statusId)
      : INVALID
  )
  guarded(ch.setMaxParallel, async (projectId, value) =>
    isId(projectId) && typeof value === 'number' && Number.isFinite(value)
      ? ok(await service.setMaxParallel(projectId, value))
      : INVALID
  )
  guarded(ch.taskDocument, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? ok(await service.taskDocument(projectId, taskId)) : INVALID
  )
  guarded(ch.taskSummary, async (projectId, taskId) =>
    isId(projectId) && isId(taskId) ? ok(await service.taskSummary(projectId, taskId)) : INVALID
  )
}

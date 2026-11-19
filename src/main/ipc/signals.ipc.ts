import type { IpcMain } from 'electron'
import { IPC_CHANNELS, type NotionResult } from '../../shared/ipc-contract'
import type { TaskSignalsService } from '../signals/task-signals.service'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'

const GENERIC: NotionResult<never> = {
  ok: false,
  error: { code: 'unexpected', message: 'Algo deu errado ao ler branches e PRs. Tente novamente.' }
}
const INVALID: NotionResult<never> = {
  ok: false,
  error: { code: 'invalid', message: 'Projeto inválido. Atualize a tela e tente de novo.' }
}

/** Sinais das tarefas (branches/PRs). O renderer manda só o id do projeto. */
export function registerSignalsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<TaskSignalsService, 'get'>,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  ipc.handle(IPC_CHANNELS.signals.get, async (event, projectId: unknown, options: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    try {
      await ready
      if (!isId(projectId)) return INVALID
      const force =
        typeof options === 'object' &&
        options !== null &&
        (options as { force?: unknown }).force === true
      return await service.get(projectId, { force })
    } catch (error) {
      console.error(`[orkio] falha inesperada em ${IPC_CHANNELS.signals.get}: ${errorName(error)}`)
      return GENERIC
    }
  })
}

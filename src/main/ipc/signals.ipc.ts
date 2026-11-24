import type { IpcMain } from 'electron'
import { IPC_CHANNELS, type NotionResult } from '../../shared/ipc-contract'
import type { ReviewThreadsService } from '../signals/review-threads'
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
  ready: Promise<void> = Promise.resolve(),
  reviews?: Pick<ReviewThreadsService, 'get'>
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

  // Threads da PR da tarefa (Task 15): o renderer manda só ids; o main acha a PR pelos sinais.
  ipc.handle(
    IPC_CHANNELS.signals.reviewThreads,
    async (event, projectId: unknown, taskId: unknown, options: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        if (!isId(projectId) || !isId(taskId) || !reviews) return INVALID
        const force =
          typeof options === 'object' &&
          options !== null &&
          (options as { force?: unknown }).force === true
        const r = await reviews.get(projectId, taskId, force)
        return r.ok
          ? ({ ok: true, value: r.value } satisfies NotionResult<unknown>)
          : ({
              ok: false,
              error: { code: r.code, message: r.message }
            } satisfies NotionResult<never>)
      } catch (error) {
        console.error(
          `[orkio] falha inesperada em ${IPC_CHANNELS.signals.reviewThreads}: ${errorName(error)}`
        )
        return GENERIC
      }
    }
  )
}

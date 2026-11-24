import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { errorName } from './payload'
import { isId } from './projects.ipc'
import type { SenderGuard } from './trusted-sender'
import type { AutomationStatus } from '../../shared/automation'

export interface AutomationIpcService {
  status(projectId: string): AutomationStatus
  runNow(projectId: string): Promise<AutomationStatus>
  setPaused(paused: boolean): Promise<AutomationStatus>
}

const FALLBACK: AutomationStatus = {
  paused: false,
  github: 'unknown',
  lastRunAt: null,
  nextRunAt: null,
  error: 'Não foi possível consultar as automações.'
}

/** Automações (3B): o renderer manda só o id do projeto ou um booleano. */
export function registerAutomationIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: AutomationIpcService,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const ch = IPC_CHANNELS.automation
  function guarded(channel: string, run: (...args: unknown[]) => Promise<AutomationStatus>): void {
    ipc.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(...args)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return FALLBACK
      }
    })
  }
  guarded(ch.status, async (projectId) => (isId(projectId) ? service.status(projectId) : FALLBACK))
  guarded(ch.runNow, async (projectId) => (isId(projectId) ? service.runNow(projectId) : FALLBACK))
  guarded(ch.setPaused, async (paused) =>
    typeof paused === 'boolean' ? service.setPaused(paused) : FALLBACK
  )
}

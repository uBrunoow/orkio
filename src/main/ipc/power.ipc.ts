import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { errorName } from './payload'
import type { SenderGuard } from './trusted-sender'

export interface PowerIpcService {
  keepAwake(): boolean
  setKeepAwake(enabled: boolean): Promise<boolean>
}

/** Energia: o renderer só liga/desliga "Manter o computador acordado" (booleano). */
export function registerPowerIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: PowerIpcService,
  isTrustedSender: SenderGuard
): void {
  const ch = IPC_CHANNELS.power
  ipc.handle(ch.get, (event) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    return service.keepAwake()
  })
  ipc.handle(ch.setKeepAwake, async (event, enabled: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    try {
      return await service.setKeepAwake(enabled === true)
    } catch (error) {
      console.error(`[orkio] falha inesperada em ${ch.setKeepAwake}: ${errorName(error)}`)
      return service.keepAwake()
    }
  })
}

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  IPC_CHANNELS,
  type ConnectionStatus,
  type DeviceFlowStartResult
} from '../../shared/ipc-contract'
import type { DeviceFlowConnector } from '../connectors/types'
import { errorName, isTokenCredentials } from './payload'
import type { SenderGuard } from './trusted-sender'

const GENERIC_ERROR: ConnectionStatus = {
  state: 'error',
  message: 'Algo deu errado na integração com o GitHub. Tente novamente.'
}

export interface GitHubIpcHooks {
  /** Chamado quando o Device Flow termina (ex.: trazer a janela do Orkio para a frente). */
  onDeviceFlowFinished?(event: IpcMainInvokeEvent): void
}

export function registerGitHubIpc(
  ipc: Pick<IpcMain, 'handle'>,
  connector: DeviceFlowConnector,
  isTrustedSender: SenderGuard,
  hooks: GitHubIpcHooks = {}
): void {
  const { github } = IPC_CHANNELS

  /** Handler com checagem de origem e erro genérico (sem logar mensagem/stack). */
  function guarded<T>(
    channel: string,
    fallback: T,
    run: (payload: unknown, event: IpcMainInvokeEvent) => T | Promise<T>
  ): void {
    ipc.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        return await run(payload, event)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback
      }
    })
  }

  guarded(github.getStatus, GENERIC_ERROR, () => connector.getStatus())
  guarded(github.testConnection, GENERIC_ERROR, () => connector.testConnection())
  guarded<ConnectionStatus>(github.connect, GENERIC_ERROR, (payload) =>
    isTokenCredentials(payload)
      ? connector.connect({ kind: 'token', token: payload.token })
      : { state: 'error', message: 'Cole o token do GitHub para conectar.' }
  )
  guarded<ConnectionStatus>(github.disconnect, GENERIC_ERROR, async () => {
    await connector.disconnect()
    return { state: 'disconnected' }
  })
  guarded(github.getAuthOptions, { oauth: false }, () => connector.getAuthOptions())
  guarded<DeviceFlowStartResult>(github.startDeviceFlow, { ok: false, status: GENERIC_ERROR }, () =>
    connector.startDeviceFlow()
  )
  guarded(github.waitDeviceFlow, GENERIC_ERROR, async (_payload, event) => {
    try {
      return await connector.waitDeviceFlow()
    } finally {
      hooks.onDeviceFlowFinished?.(event)
    }
  })
  guarded(github.cancelDeviceFlow, undefined, () => connector.cancelDeviceFlow())
}

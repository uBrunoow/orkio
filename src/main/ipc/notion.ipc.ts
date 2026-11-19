import type { IpcMain } from 'electron'
import {
  IPC_CHANNELS,
  type ConnectionStatus,
  type ConnectorCredentials
} from '../../shared/ipc-contract'
import type { Connector } from '../connectors/types'
import type { SenderGuard } from './trusted-sender'

const GENERIC_ERROR: ConnectionStatus = {
  state: 'error',
  message: 'Algo deu errado na integração com o Notion. Tente novamente.'
}

export function registerNotionIpc(
  ipc: Pick<IpcMain, 'handle'>,
  connector: Connector,
  isTrustedSender: SenderGuard
): void {
  const { notion } = IPC_CHANNELS

  const handle = (channel: string, run: (payload: unknown) => Promise<ConnectionStatus>): void => {
    ipc.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        return await run(payload)
      } catch (error) {
        // Nunca logamos a mensagem/stack: podem conter dados sensíveis.
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return GENERIC_ERROR
      }
    })
  }

  handle(notion.getStatus, () => connector.getStatus())
  handle(notion.testConnection, () => connector.testConnection())
  handle(notion.connect, (payload) => {
    if (!isTokenCredentials(payload)) {
      return Promise.resolve<ConnectionStatus>({
        state: 'error',
        message: 'Cole o token do Notion para conectar.'
      })
    }
    return connector.connect({ kind: 'token', token: payload.token })
  })
  handle(notion.disconnect, async () => {
    await connector.disconnect()
    return { state: 'disconnected' }
  })
}

export function isTokenCredentials(value: unknown): value is ConnectorCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'token' &&
    typeof (value as { token?: unknown }).token === 'string'
  )
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

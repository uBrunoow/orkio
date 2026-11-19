import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  IPC_CHANNELS,
  type ConnectionStatus,
  type ConnectorCredentials
} from '../../shared/ipc-contract'
import type { OAuthConnector } from '../connectors/types'
import type { SenderGuard } from './trusted-sender'

const GENERIC_ERROR: ConnectionStatus = {
  state: 'error',
  message: 'Algo deu errado na integração com o Notion. Tente novamente.'
}

export interface NotionIpcHooks {
  /** Chamado quando o fluxo OAuth termina (ex.: trazer a janela do Orkio para a frente). */
  onOAuthFinished?(event: IpcMainInvokeEvent): void
}

export function registerNotionIpc(
  ipc: Pick<IpcMain, 'handle'>,
  connector: OAuthConnector,
  isTrustedSender: SenderGuard,
  hooks: NotionIpcHooks = {}
): void {
  const { notion } = IPC_CHANNELS

  const handle = (
    channel: string,
    run: (payload: unknown, event: IpcMainInvokeEvent) => Promise<ConnectionStatus>
  ): void => {
    ipc.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        return await run(payload, event)
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
  handle(notion.startOAuth, async (_payload, event) => {
    try {
      return await connector.startOAuth()
    } finally {
      hooks.onOAuthFinished?.(event)
    }
  })

  ipc.handle(notion.getAuthOptions, (event) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    return connector.getAuthOptions()
  })
  ipc.handle(notion.cancelOAuth, (event) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    connector.cancelOAuth()
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

import type { IpcMainInvokeEvent } from 'electron'
import type { ORKIO_API } from '../../shared/ipc/api'
import type { OAuthConnector } from '../connectors/types'
import type { Impl } from './register'

/** Conexão com o Notion: o token nunca volta ao renderer, só `ConnectionStatus`. */
export function notionHandlers(
  connector: OAuthConnector,
  /** Fim do fluxo OAuth (ex.: trazer a janela do Orkio para a frente). */
  onOAuthFinished: (event: IpcMainInvokeEvent) => void
): Impl<typeof ORKIO_API.notion> {
  return {
    getStatus: () => connector.getStatus(),
    connect: (credentials) => connector.connect(credentials),
    disconnect: async () => {
      await connector.disconnect()
      return { state: 'disconnected' }
    },
    testConnection: () => connector.testConnection(),
    getAuthOptions: () => connector.getAuthOptions(),
    startOAuth: async (event) => {
      try {
        return await connector.startOAuth()
      } finally {
        onOAuthFinished(event)
      }
    },
    cancelOAuth: () => connector.cancelOAuth()
  }
}

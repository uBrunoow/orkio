import type { IpcMainInvokeEvent } from 'electron'
import type { ConnectionStatus } from '../../shared/connection'
import type { ORKIO_API } from '../../shared/ipc/api'
import type { OAuthConnector } from '../connectors/types'
import type { Impl } from './register'

/** Conexão com o Notion: o token nunca volta ao renderer, só `ConnectionStatus`. */
export function notionHandlers(
  connector: OAuthConnector,
  /** Fim do fluxo OAuth (ex.: trazer a janela do Orkio para a frente). */
  onOAuthFinished: (event: IpcMainInvokeEvent) => void,
  /** A conexão pode ter mudado: avisa as janelas. */
  onChanged: () => void
): Impl<typeof ORKIO_API.notion> {
  const changes = <T>(run: Promise<T>): Promise<T> => run.finally(onChanged)
  return {
    getStatus: () => connector.getStatus(),
    connect: (credentials) => changes(connector.connect(credentials)),
    disconnect: () =>
      changes(connector.disconnect()).then((): ConnectionStatus => ({ state: 'disconnected' })),
    testConnection: () => changes(connector.testConnection()),
    getAuthOptions: () => connector.getAuthOptions(),
    startOAuth: async (event) => {
      try {
        return await changes(connector.startOAuth())
      } finally {
        onOAuthFinished(event)
      }
    },
    cancelOAuth: () => connector.cancelOAuth()
  }
}

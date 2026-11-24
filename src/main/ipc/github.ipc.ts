import type { IpcMainInvokeEvent } from 'electron'
import type { ConnectionStatus } from '../../shared/connection'
import type { ORKIO_API } from '../../shared/ipc/api'
import type { OrkioBotStatus } from '../../shared/orkio-bot'
import type { DeviceFlowConnector } from '../connectors/types'
import type { Impl } from './register'

export interface GitHubIpcDeps {
  /** Fim do Device Flow (ex.: trazer a janela do Orkio para a frente). */
  onDeviceFlowFinished(event: IpcMainInvokeEvent): void
  /** orkio[bot] instalado nos repositórios dos projetos (cartão de Integrações). */
  orkioBot(force: boolean): Promise<OrkioBotStatus>
  /** A conexão pode ter mudado: avisa as janelas. */
  onChanged(): void
}

/** Conexão com o GitHub: o token nunca volta ao renderer, só `ConnectionStatus`. */
export function githubHandlers(
  connector: DeviceFlowConnector,
  deps: GitHubIpcDeps
): Impl<typeof ORKIO_API.github> {
  const changes = <T>(run: Promise<T>): Promise<T> => run.finally(() => deps.onChanged())
  return {
    getStatus: () => connector.getStatus(),
    connect: (credentials) => changes(connector.connect(credentials)),
    disconnect: () =>
      changes(connector.disconnect()).then((): ConnectionStatus => ({ state: 'disconnected' })),
    testConnection: () => changes(connector.testConnection()),
    getAuthOptions: () => connector.getAuthOptions(),
    startDeviceFlow: () => connector.startDeviceFlow(),
    waitDeviceFlow: async (event) => {
      try {
        return await changes(connector.waitDeviceFlow())
      } finally {
        deps.onDeviceFlowFinished(event)
      }
    },
    cancelDeviceFlow: () => connector.cancelDeviceFlow(),
    orkioBot: (options) => deps.orkioBot(options.force)
  }
}

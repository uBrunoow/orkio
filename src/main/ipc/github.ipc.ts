import type { IpcMainInvokeEvent } from 'electron'
import type { ORKIO_API } from '../../shared/ipc/api'
import type { OrkioBotStatus } from '../../shared/orkio-bot'
import type { DeviceFlowConnector } from '../connectors/types'
import type { Impl } from './register'

export interface GitHubIpcDeps {
  /** Fim do Device Flow (ex.: trazer a janela do Orkio para a frente). */
  onDeviceFlowFinished(event: IpcMainInvokeEvent): void
  /** orkio[bot] instalado nos repositórios dos projetos (cartão de Integrações). */
  orkioBot(force: boolean): Promise<OrkioBotStatus>
}

/** Conexão com o GitHub: o token nunca volta ao renderer, só `ConnectionStatus`. */
export function githubHandlers(
  connector: DeviceFlowConnector,
  deps: GitHubIpcDeps
): Impl<typeof ORKIO_API.github> {
  return {
    getStatus: () => connector.getStatus(),
    connect: (credentials) => connector.connect(credentials),
    disconnect: async () => {
      await connector.disconnect()
      return { state: 'disconnected' }
    },
    testConnection: () => connector.testConnection(),
    getAuthOptions: () => connector.getAuthOptions(),
    startDeviceFlow: () => connector.startDeviceFlow(),
    waitDeviceFlow: async (event) => {
      try {
        return await connector.waitDeviceFlow()
      } finally {
        deps.onDeviceFlowFinished(event)
      }
    },
    cancelDeviceFlow: () => connector.cancelDeviceFlow(),
    orkioBot: (options) => deps.orkioBot(options.force)
  }
}

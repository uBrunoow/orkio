import type {
  ConnectionStatus,
  ConnectorCredentials,
  ConnectorId
} from '../../shared/ipc-contract'

export type { ConnectionStatus, ConnectorCredentials, ConnectorId }

/**
 * Contrato de toda integração externa (Notion hoje; GitHub e Claude Code depois).
 *
 * Regras:
 * - Roda apenas no processo main.
 * - Nunca devolve credenciais: só `ConnectionStatus`.
 * - Não lança para erros esperados (token inválido, rede, rate limit):
 *   converte em `{ state: 'error' }` ou `warning` com mensagem em pt-BR.
 */
export interface Connector<C extends ConnectorCredentials = ConnectorCredentials> {
  readonly id: ConnectorId
  connect(credentials: C): Promise<ConnectionStatus>
  disconnect(): Promise<void>
  /** Status salvo localmente, sem rede. */
  getStatus(): Promise<ConnectionStatus>
  /** Revalida a credencial salva contra a API do serviço. */
  testConnection(): Promise<ConnectionStatus>
}

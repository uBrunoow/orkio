import type {
  AuthOptions,
  ConnectionStatus,
  ConnectorCredentials,
  ConnectorId,
  DeviceFlowStartResult,
  TokenCredentials
} from '../../shared/ipc-contract'

export type {
  AuthOptions,
  ConnectionStatus,
  ConnectorCredentials,
  ConnectorId,
  DeviceFlowStartResult,
  TokenCredentials
}

/**
 * Credenciais obtidas via OAuth. Só existem no processo main: nunca vêm do renderer
 * nem voltam para ele. `TTokens` é o conjunto de tokens específico de cada serviço.
 */
export type OAuthCredentials<TTokens> = { kind: 'oauth'; tokens: TTokens }

/**
 * Contrato de toda integração externa (Notion hoje; GitHub e Claude Code depois).
 *
 * Regras:
 * - Roda apenas no processo main.
 * - Nunca devolve credenciais: só `ConnectionStatus`.
 * - Não lança para erros esperados (token inválido, rede, rate limit):
 *   converte em `{ state: 'error' }` ou `warning` com mensagem em pt-BR.
 */
export interface Connector<C = ConnectorCredentials> {
  readonly id: ConnectorId
  connect(credentials: C): Promise<ConnectionStatus>
  disconnect(): Promise<void>
  /** Status salvo localmente, sem rede. */
  getStatus(): Promise<ConnectionStatus>
  /** Revalida a credencial salva contra a API do serviço. */
  testConnection(): Promise<ConnectionStatus>
}

/** Conector que também conecta via OAuth (fluxo inteiro no main). */
export interface OAuthConnector<C = ConnectorCredentials> extends Connector<C> {
  getAuthOptions(): AuthOptions
  /** Roda o fluxo OAuth. Resolve com o status final (ou com o status salvo, se cancelado). */
  startOAuth(): Promise<ConnectionStatus>
  cancelOAuth(): void
}

/**
 * Conector que conecta via OAuth Device Flow (RFC 8628): o polling roda no main e a UI só
 * recebe o código a digitar (`startDeviceFlow`) e o resultado final (`waitDeviceFlow`).
 */
export interface DeviceFlowConnector<C = ConnectorCredentials> extends Connector<C> {
  getAuthOptions(): AuthOptions
  startDeviceFlow(): Promise<DeviceFlowStartResult>
  waitDeviceFlow(): Promise<ConnectionStatus>
  cancelDeviceFlow(): void
}

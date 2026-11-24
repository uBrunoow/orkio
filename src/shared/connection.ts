/** Conexão com os serviços externos (Notion, GitHub): estado, credenciais, Device Flow. */

/** Conectores existentes. Depois: 'claude-code'. */
export type ConnectorId = 'notion' | 'github'

export interface ConnectedAccount {
  userName: string
  /** Identificador público da conta (ex.: login do GitHub, sem "@"). */
  handle?: string
  workspaceName?: string
  avatarUrl?: string
}

export type ConnectionStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | {
      state: 'connected'
      account: ConnectedAccount
      connectedAt: string
      /** Conectado, mas a última verificação falhou por motivo transitório (rede, 5xx, 429). */
      warning?: string
    }
  | {
      state: 'error'
      message: string
      /** true quando ainda existe credencial salva (ex.: token revogado). */
      hasStoredCredentials?: boolean
    }

/**
 * Credenciais que o RENDERER pode enviar (token colado pelo usuário).
 * Credenciais OAuth nunca passam pelo renderer: o fluxo roda inteiro no main
 * (ver `OAuthCredentials` em src/main/connectors/types.ts).
 */
export type TokenCredentials = { kind: 'token'; token: string }
export type ConnectorCredentials = TokenCredentials

/** Métodos de conexão disponíveis neste build. */
export interface AuthOptions {
  /** false quando o build não tem a config OAuth do serviço (client ID etc.). */
  oauth: boolean
}

/** Dados que o usuário precisa para concluir um Device Flow (nunca inclui tokens). */
export interface DeviceFlowInfo {
  /** Código que o usuário digita no navegador (ex.: "WDJB-MJHT"). */
  userCode: string
  /** Página onde o código é digitado (ex.: https://github.com/login/device). */
  verificationUri: string
  /** Quando o código expira (ISO 8601). */
  expiresAt: string
}

export type DeviceFlowStartResult =
  { ok: true; flow: DeviceFlowInfo } | { ok: false; status: ConnectionStatus }

export const NOTION_TOKEN_DOCS_URL =
  'https://developers.notion.com/guides/get-started/personal-access-tokens'

export const GITHUB_TOKEN_DOCS_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token'

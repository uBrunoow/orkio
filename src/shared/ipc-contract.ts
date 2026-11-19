/**
 * Contrato compartilhado entre main, preload e renderer.
 * Só tipos e constantes — nada aqui pode depender de Node ou do DOM.
 */

export const IPC_CHANNELS = {
  notion: {
    getStatus: 'notion:get-status',
    connect: 'notion:connect',
    disconnect: 'notion:disconnect',
    testConnection: 'notion:test-connection',
    getAuthOptions: 'notion:get-auth-options',
    startOAuth: 'notion:oauth-start',
    cancelOAuth: 'notion:oauth-cancel'
  },
  github: {
    getStatus: 'github:get-status',
    connect: 'github:connect',
    disconnect: 'github:disconnect',
    testConnection: 'github:test-connection',
    getAuthOptions: 'github:get-auth-options',
    startDeviceFlow: 'github:device-flow-start',
    waitDeviceFlow: 'github:device-flow-wait',
    cancelDeviceFlow: 'github:device-flow-cancel'
  },
  shell: {
    openExternal: 'shell:open-external'
  }
} as const

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
  | { ok: true; flow: DeviceFlowInfo }
  | { ok: false; status: ConnectionStatus }

/** API exposta pelo preload em `window.orkio`. */
export interface OrkioApi {
  notion: {
    getStatus(): Promise<ConnectionStatus>
    connect(credentials: ConnectorCredentials): Promise<ConnectionStatus>
    disconnect(): Promise<ConnectionStatus>
    testConnection(): Promise<ConnectionStatus>
    getAuthOptions(): Promise<AuthOptions>
    /**
     * Abre o Notion no navegador para o usuário autorizar o Orkio.
     * Resolve quando o fluxo termina (conectado, erro ou cancelado — neste caso, o status salvo).
     */
    startOAuth(): Promise<ConnectionStatus>
    cancelOAuth(): Promise<void>
  }
  github: {
    getStatus(): Promise<ConnectionStatus>
    connect(credentials: ConnectorCredentials): Promise<ConnectionStatus>
    disconnect(): Promise<ConnectionStatus>
    testConnection(): Promise<ConnectionStatus>
    getAuthOptions(): Promise<AuthOptions>
    /**
     * Pede um código ao GitHub e começa a aguardar a autorização (no main).
     * Se já houver um fluxo em andamento, devolve o mesmo código.
     */
    startDeviceFlow(): Promise<DeviceFlowStartResult>
    /** Resolve quando o fluxo termina: conectado, erro ou cancelado (status salvo). */
    waitDeviceFlow(): Promise<ConnectionStatus>
    cancelDeviceFlow(): Promise<void>
  }
  /** Abre um link no navegador padrão. Só domínios da allowlist do main são aceitos. */
  openExternal(url: string): Promise<boolean>
}

export const NOTION_TOKEN_DOCS_URL =
  'https://developers.notion.com/guides/get-started/personal-access-tokens'

export const GITHUB_TOKEN_DOCS_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token'

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
  shell: {
    openExternal: 'shell:open-external'
  }
} as const

/** Conectores existentes. Depois: 'github' | 'claude-code'. */
export type ConnectorId = 'notion'

export interface ConnectedAccount {
  userName: string
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
  /** false quando o build não tem client ID / URL do intermediário OAuth configurados. */
  oauth: boolean
}

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
  /** Abre um link no navegador padrão. Só domínios da allowlist do main são aceitos. */
  openExternal(url: string): Promise<boolean>
}

export const NOTION_TOKEN_DOCS_URL =
  'https://developers.notion.com/guides/get-started/personal-access-tokens'

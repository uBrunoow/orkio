/**
 * Contrato compartilhado entre main, preload e renderer.
 * Só tipos e constantes — nada aqui pode depender de Node ou do DOM.
 */

export const IPC_CHANNELS = {
  notion: {
    getStatus: 'notion:get-status',
    connect: 'notion:connect',
    disconnect: 'notion:disconnect',
    testConnection: 'notion:test-connection'
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
 * Credenciais aceitas por um conector. União discriminada para que uma
 * variante OAuth (`{ kind: 'oauth'; ... }`) possa ser adicionada no futuro.
 */
export type TokenCredentials = { kind: 'token'; token: string }
export type ConnectorCredentials = TokenCredentials

/** API exposta pelo preload em `window.orkio`. */
export interface OrkioApi {
  notion: {
    getStatus(): Promise<ConnectionStatus>
    connect(credentials: ConnectorCredentials): Promise<ConnectionStatus>
    disconnect(): Promise<ConnectionStatus>
    testConnection(): Promise<ConnectionStatus>
  }
  /** Abre um link no navegador padrão. Só domínios da allowlist do main são aceitos. */
  openExternal(url: string): Promise<boolean>
}

export const NOTION_TOKEN_DOCS_URL =
  'https://developers.notion.com/guides/get-started/personal-access-tokens'

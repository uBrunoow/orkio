import type { ConnectedAccount } from '../../../shared/ipc-contract'
import { EncryptionUnavailableError, type SecretStore } from '../../storage/secure-store'
import type { ConnectionStatus, Connector, ConnectorCredentials } from '../types'
import { NotionApiError, type NotionClient, type NotionSelf } from './notion.client'

const SECRET_KEY = 'notion'
const MAX_TOKEN_LENGTH = 1024

/** O que fica salvo (criptografado) no disco. */
interface StoredNotionConnection {
  v: 1
  token: string
  account: ConnectedAccount
  connectedAt: string
}

export const NOTION_MESSAGES = {
  emptyToken: 'Cole o token do Notion para conectar.',
  malformedToken: 'Esse token não parece válido. Copie o token completo, sem espaços.',
  encryptionUnavailable:
    'Seu sistema não oferece armazenamento seguro de credenciais (keychain/keyring). ' +
    'O token não foi salvo. No Linux, instale e desbloqueie o GNOME Keyring ou o KWallet.',
  storageReadFailed:
    'Não foi possível ler a conexão salva com o Notion. Desconecte e conecte novamente.',
  storageWriteFailed: 'Não foi possível salvar a conexão com o Notion. Tente novamente.',
  unknown: 'Algo deu errado ao falar com o Notion. Tente novamente.'
} as const

export interface NotionConnectorDeps {
  store: SecretStore
  client: NotionClient
  now?: () => Date
}

export class NotionConnector implements Connector {
  readonly id = 'notion' as const
  private readonly now: () => Date

  constructor(private readonly deps: NotionConnectorDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async connect(credentials: ConnectorCredentials): Promise<ConnectionStatus> {
    if (credentials.kind !== 'token') return error(NOTION_MESSAGES.unknown)

    const token = credentials.token.trim()
    if (token === '') return error(NOTION_MESSAGES.emptyToken)
    if (token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return error(NOTION_MESSAGES.malformedToken)
    }

    // Checa antes de chamar o Notion para não validar um token que não poderemos guardar.
    if (!this.deps.store.isAvailable()) return error(NOTION_MESSAGES.encryptionUnavailable)

    let self: NotionSelf
    try {
      self = await this.deps.client.getSelf(token)
    } catch (e) {
      return error(messageFor(e))
    }

    const record: StoredNotionConnection = {
      v: 1,
      token,
      account: toAccount(self),
      connectedAt: this.now().toISOString()
    }
    try {
      await this.save(record)
    } catch (e) {
      return error(
        e instanceof EncryptionUnavailableError
          ? NOTION_MESSAGES.encryptionUnavailable
          : NOTION_MESSAGES.storageWriteFailed
      )
    }
    return connected(record)
  }

  async disconnect(): Promise<void> {
    await this.deps.store.delete(SECRET_KEY)
  }

  async getStatus(): Promise<ConnectionStatus> {
    const loaded = await this.load()
    if (loaded.kind === 'none') return { state: 'disconnected' }
    if (loaded.kind === 'error') return loaded.status
    return connected(loaded.record)
  }

  async testConnection(): Promise<ConnectionStatus> {
    const loaded = await this.load()
    if (loaded.kind === 'none') return { state: 'disconnected' }
    if (loaded.kind === 'error') return loaded.status
    const { record } = loaded

    let self: NotionSelf
    try {
      self = await this.deps.client.getSelf(record.token)
    } catch (e) {
      if (e instanceof NotionApiError && (e.code === 'unauthorized' || e.code === 'forbidden')) {
        // Credencial salva não vale mais: mostramos erro, mas mantemos o arquivo até o usuário desconectar.
        return { state: 'error', message: e.message, hasStoredCredentials: true }
      }
      // Falha transitória: continua conectado, com aviso.
      return { ...connected(record), warning: messageFor(e) }
    }

    const refreshed: StoredNotionConnection = { ...record, account: toAccount(self) }
    try {
      await this.save(refreshed)
    } catch {
      // Falha ao atualizar dados de exibição não invalida a conexão.
    }
    return connected(refreshed)
  }

  private async save(record: StoredNotionConnection): Promise<void> {
    await this.deps.store.set(SECRET_KEY, JSON.stringify(record))
  }

  private async load(): Promise<
    | { kind: 'none' }
    | { kind: 'ok'; record: StoredNotionConnection }
    | { kind: 'error'; status: ConnectionStatus }
  > {
    let raw: string | null
    try {
      raw = await this.deps.store.get(SECRET_KEY)
    } catch (e) {
      const message =
        e instanceof EncryptionUnavailableError
          ? NOTION_MESSAGES.encryptionUnavailable
          : NOTION_MESSAGES.storageReadFailed
      return { kind: 'error', status: { state: 'error', message, hasStoredCredentials: true } }
    }
    if (raw === null) return { kind: 'none' }

    const record = parseStored(raw)
    if (!record) {
      return {
        kind: 'error',
        status: {
          state: 'error',
          message: NOTION_MESSAGES.storageReadFailed,
          hasStoredCredentials: true
        }
      }
    }
    return { kind: 'ok', record }
  }
}

/** Converte o dono do token no formato exibido pela UI. */
export function toAccount(self: NotionSelf): ConnectedAccount {
  const userName =
    self.type === 'bot'
      ? (self.ownerName ?? self.name ?? 'Integração do Notion')
      : (self.name ?? 'Usuário do Notion')
  const avatarUrl = self.type === 'bot' ? (self.ownerAvatarUrl ?? self.avatarUrl) : self.avatarUrl

  const account: ConnectedAccount = { userName }
  if (self.workspaceName) account.workspaceName = self.workspaceName
  if (avatarUrl) account.avatarUrl = avatarUrl
  return account
}

type ConnectedStatus = Extract<ConnectionStatus, { state: 'connected' }>

function connected(record: StoredNotionConnection): ConnectedStatus {
  return { state: 'connected', account: record.account, connectedAt: record.connectedAt }
}

function error(message: string): ConnectionStatus {
  return { state: 'error', message }
}

function messageFor(e: unknown): string {
  return e instanceof NotionApiError ? e.message : NOTION_MESSAGES.unknown
}

function parseStored(raw: string): StoredNotionConnection | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const r = value as Partial<StoredNotionConnection>
    if (
      r.v !== 1 ||
      typeof r.token !== 'string' ||
      r.token === '' ||
      typeof r.connectedAt !== 'string' ||
      typeof r.account !== 'object' ||
      r.account === null ||
      typeof r.account.userName !== 'string'
    ) {
      return null
    }
    return r as StoredNotionConnection
  } catch {
    return null
  }
}

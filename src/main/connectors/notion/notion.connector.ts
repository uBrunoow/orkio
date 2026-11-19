import type { AuthOptions, ConnectedAccount } from '../../../shared/ipc-contract'
import { LoopbackAuthError } from '../../oauth/loopback'
import { EncryptionUnavailableError, type SecretStore } from '../../storage/secure-store'
import type { ConnectionStatus, OAuthConnector, OAuthCredentials, TokenCredentials } from '../types'
import {
  NotionApiError,
  type NotionClient,
  type NotionListPage,
  type NotionQueryOptions,
  type NotionSelf
} from './notion.client'
import type { NotionOAuthBroker, NotionTokenSet } from './notion.oauth'

const SECRET_KEY = 'notion'
const MAX_TOKEN_LENGTH = 1024

export type NotionCredentials = TokenCredentials | OAuthCredentials<NotionTokenSet>

interface StoredBase {
  v: 2
  account: ConnectedAccount
  connectedAt: string
}

/** O que fica salvo (criptografado) no disco. */
type StoredNotionConnection =
  | (StoredBase & { method: 'token'; token: string })
  | (StoredBase & {
      method: 'oauth'
      accessToken: string
      refreshToken: string | null
      botId: string
      workspaceId: string | null
    })

type StoredOAuth = Extract<StoredNotionConnection, { method: 'oauth' }>

export const NOTION_MESSAGES = {
  emptyToken: 'Cole o token do Notion para conectar.',
  malformedToken: 'Esse token não parece válido. Copie o token completo, sem espaços.',
  encryptionUnavailable:
    'Seu sistema não oferece armazenamento seguro de credenciais (keychain/keyring). ' +
    'O token não foi salvo. No Linux, instale e desbloqueie o GNOME Keyring ou o KWallet.',
  storageReadFailed:
    'Não foi possível ler a conexão salva com o Notion. Desconecte e conecte novamente.',
  storageWriteFailed: 'Não foi possível salvar a conexão com o Notion. Tente novamente.',
  unknown: 'Algo deu errado ao falar com o Notion. Tente novamente.',
  oauthUnavailable: 'O login com Notion não está disponível nesta versão do Orkio. Use um token.',
  oauthInProgress: 'Já existe uma conexão com o Notion em andamento. Conclua ou cancele.',
  oauthRevoked: 'A autorização do Notion expirou ou foi revogada. Conecte o Notion de novo.',
  notConnected: 'Conecte sua conta do Notion em Integrações para continuar.',
  tokenRevoked: 'O token do Notion foi revogado ou expirou. Conecte o Notion de novo.'
} as const

/** Como a conta foi conectada (o OAuth só enxerga páginas escolhidas na autorização). */
export type NotionConnectionMethod = 'oauth' | 'token'

/** Peças do OAuth injetadas pelo main (navegador + loopback e intermediário). */
export interface NotionOAuthDeps {
  /** Abre o navegador, espera o redirect e devolve o `code`. */
  authorize(signal: AbortSignal): Promise<{ code: string }>
  broker: NotionOAuthBroker
  redirectUri: string
}

export interface NotionConnectorDeps {
  store: SecretStore
  client: NotionClient
  /** Ausente quando o build não tem OAuth configurado. */
  oauth?: NotionOAuthDeps | null
  now?: () => Date
}

export class NotionConnector implements OAuthConnector<NotionCredentials> {
  readonly id = 'notion' as const
  private readonly now: () => Date
  private flow: AbortController | null = null
  /** Renovação em andamento: o Notion gira o refresh token, então nunca renovamos em paralelo. */
  private refreshing: Promise<StoredOAuth> | null = null

  constructor(private readonly deps: NotionConnectorDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  getAuthOptions(): AuthOptions {
    return { oauth: Boolean(this.deps.oauth) }
  }

  async connect(credentials: NotionCredentials): Promise<ConnectionStatus> {
    return credentials.kind === 'oauth'
      ? this.connectWithOAuthTokens(credentials.tokens)
      : this.connectWithToken(credentials.token)
  }

  async startOAuth(): Promise<ConnectionStatus> {
    const oauth = this.deps.oauth
    if (!oauth) return error(NOTION_MESSAGES.oauthUnavailable)
    if (this.flow) return error(NOTION_MESSAGES.oauthInProgress)
    if (!this.deps.store.isAvailable()) return error(NOTION_MESSAGES.encryptionUnavailable)

    const controller = new AbortController()
    this.flow = controller
    try {
      let code: string
      try {
        ;({ code } = await oauth.authorize(controller.signal))
      } catch (e) {
        if (e instanceof LoopbackAuthError && e.code === 'cancelled') return this.getStatus()
        return this.errorKeepingStored(
          e instanceof LoopbackAuthError ? e.message : NOTION_MESSAGES.unknown
        )
      }

      let tokens: NotionTokenSet
      try {
        tokens = await oauth.broker.exchangeCode(code, oauth.redirectUri)
      } catch (e) {
        return this.errorKeepingStored(messageFor(e))
      }
      // Cancelado enquanto trocava o código: descarta os tokens.
      if (controller.signal.aborted) return this.getStatus()

      return await this.connectWithOAuthTokens(tokens)
    } finally {
      this.flow = null
    }
  }

  cancelOAuth(): void {
    this.flow?.abort()
  }

  async disconnect(): Promise<void> {
    this.cancelOAuth()
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

    let self: NotionSelf
    let record: StoredNotionConnection = loaded.record
    try {
      const result = await this.withAccessToken(loaded.record, (token) =>
        this.deps.client.getSelf(token)
      )
      self = result.value
      record = result.record
    } catch (e) {
      if (isTerminalAuthError(e)) {
        const apiError = e as NotionApiError
        const message =
          loaded.record.method === 'oauth' && apiError.code !== 'oauth_config'
            ? NOTION_MESSAGES.oauthRevoked
            : apiError.message
        // Mantemos o arquivo até o usuário desconectar ou reconectar.
        return { state: 'error', message, hasStoredCredentials: true }
      }
      // Falha transitória: continua conectado, com aviso.
      return { ...connected(record), warning: messageFor(e) }
    }

    const refreshed: StoredNotionConnection = {
      ...record,
      account: mergeAccount(toAccount(self), record.account)
    }
    try {
      await this.save(refreshed)
    } catch {
      // Falha ao atualizar dados de exibição não invalida a conexão.
    }
    return connected(refreshed)
  }

  /** Método da conexão salva, ou `null` se não houver. Sem rede. */
  async connectionMethod(): Promise<NotionConnectionMethod | null> {
    const loaded = await this.load()
    return loaded.kind === 'ok' ? loaded.record.method : null
  }

  // ---------- Leituras usadas pelos serviços (o token nunca sai do conector) ----------

  searchDataSources(options: { query?: string; startCursor?: string | null } = {}) {
    return this.callApi((token) => this.deps.client.searchDataSources(token, options))
  }

  getDataSource(id: string): Promise<unknown> {
    return this.callApi((token) => this.deps.client.getDataSource(token, id))
  }

  queryDataSource(id: string, options: NotionQueryOptions = {}): Promise<NotionListPage> {
    return this.callApi((token) => this.deps.client.queryDataSource(token, id, options))
  }

  updatePage(id: string, properties: Record<string, unknown>): Promise<void> {
    return this.callApi((token) => this.deps.client.updatePage(token, id, properties))
  }

  getBlockChildren(id: string, startCursor?: string | null): Promise<NotionListPage> {
    return this.callApi((token) => this.deps.client.getBlockChildren(token, id, startCursor))
  }

  updateDataSource(id: string, properties: Record<string, unknown>): Promise<unknown> {
    return this.callApi((token) => this.deps.client.updateDataSource(token, id, properties))
  }

  /**
   * Chamada com a conexão salva. Lança NotionApiError com mensagem segura; erros de
   * autenticação ganham a mensagem de "conectar de novo" adequada ao método.
   */
  private async callApi<T>(call: (token: string) => Promise<T>): Promise<T> {
    const loaded = await this.load()
    if (loaded.kind !== 'ok') {
      throw new NotionApiError('not_connected', NOTION_MESSAGES.notConnected)
    }
    try {
      return (await this.withAccessToken(loaded.record, call)).value
    } catch (e) {
      if (!(e instanceof NotionApiError)) {
        throw new NotionApiError('unexpected', NOTION_MESSAGES.unknown)
      }
      if (e.code === 'unauthorized' || e.code === 'invalid_grant') {
        throw new NotionApiError(
          e.code,
          loaded.record.method === 'oauth'
            ? NOTION_MESSAGES.oauthRevoked
            : NOTION_MESSAGES.tokenRevoked,
          e.status
        )
      }
      throw e
    }
  }

  /**
   * Executa uma chamada à API com o token salvo. Em conexões OAuth, um 401 dispara uma
   * renovação (serializada) e uma nova tentativa. Base para as chamadas das próximas etapas.
   */
  private async withAccessToken<T>(
    record: StoredNotionConnection,
    call: (accessToken: string) => Promise<T>
  ): Promise<{ value: T; record: StoredNotionConnection }> {
    if (record.method === 'token') return { value: await call(record.token), record }
    try {
      return { value: await call(record.accessToken), record }
    } catch (e) {
      if (!(e instanceof NotionApiError) || e.code !== 'unauthorized' || !record.refreshToken) {
        throw e
      }
    }
    const renewed = await this.refreshOAuth(record)
    return { value: await call(renewed.accessToken), record: renewed }
  }

  private refreshOAuth(record: StoredOAuth): Promise<StoredOAuth> {
    this.refreshing ??= (async () => {
      const oauth = this.deps.oauth
      if (!oauth || !record.refreshToken) {
        throw new NotionApiError('invalid_grant', NOTION_MESSAGES.oauthRevoked)
      }
      const tokens = await oauth.broker.refresh(record.refreshToken)
      const renewed: StoredOAuth = {
        ...record,
        accessToken: tokens.accessToken,
        // O Notion devolve um refresh token novo a cada renovação.
        refreshToken: tokens.refreshToken ?? record.refreshToken,
        account: mergeAccount(accountFromTokens(tokens), record.account)
      }
      await this.save(renewed)
      return renewed
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async connectWithToken(raw: string): Promise<ConnectionStatus> {
    const token = raw.trim()
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

    return this.saveAndReport({
      v: 2,
      method: 'token',
      token,
      account: toAccount(self),
      connectedAt: this.now().toISOString()
    })
  }

  private async connectWithOAuthTokens(tokens: NotionTokenSet): Promise<ConnectionStatus> {
    if (!this.deps.store.isAvailable()) return error(NOTION_MESSAGES.encryptionUnavailable)

    let account = accountFromTokens(tokens)
    let warning: string | undefined
    try {
      account = mergeAccount(toAccount(await this.deps.client.getSelf(tokens.accessToken)), account)
    } catch (e) {
      if (isTerminalAuthError(e)) return error(messageFor(e))
      // Os tokens acabaram de ser emitidos: uma falha transitória aqui não impede salvar.
      warning = messageFor(e)
    }

    const status = await this.saveAndReport({
      v: 2,
      method: 'oauth',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      botId: tokens.botId,
      workspaceId: tokens.workspaceId,
      account,
      connectedAt: this.now().toISOString()
    })
    return status.state === 'connected' && warning ? { ...status, warning } : status
  }

  private async saveAndReport(record: StoredNotionConnection): Promise<ConnectionStatus> {
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

  private async errorKeepingStored(message: string): Promise<ConnectionStatus> {
    const loaded = await this.load()
    return loaded.kind === 'none'
      ? error(message)
      : { state: 'error', message, hasStoredCredentials: true }
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

/** Dados de exibição vindos da resposta de token do OAuth. */
export function accountFromTokens(tokens: NotionTokenSet): ConnectedAccount {
  const account: ConnectedAccount = { userName: tokens.ownerName ?? 'Usuário do Notion' }
  if (tokens.workspaceName) account.workspaceName = tokens.workspaceName
  const avatar = tokens.ownerAvatarUrl ?? tokens.workspaceIconUrl
  if (avatar) account.avatarUrl = avatar
  return account
}

/** Prefere os dados novos e completa com os anteriores. */
function mergeAccount(fresh: ConnectedAccount, previous: ConnectedAccount): ConnectedAccount {
  const account: ConnectedAccount = { userName: fresh.userName || previous.userName }
  const workspaceName = fresh.workspaceName ?? previous.workspaceName
  const avatarUrl = fresh.avatarUrl ?? previous.avatarUrl
  if (workspaceName) account.workspaceName = workspaceName
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

/** Erros que exigem ação do usuário (reconectar), e não só tentar de novo. */
function isTerminalAuthError(e: unknown): boolean {
  return (
    e instanceof NotionApiError &&
    (e.code === 'unauthorized' ||
      e.code === 'forbidden' ||
      e.code === 'invalid_grant' ||
      e.code === 'oauth_config')
  )
}

function parseStored(raw: string): StoredNotionConnection | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const account = r['account'] as Partial<ConnectedAccount> | null | undefined
  if (
    typeof r['connectedAt'] !== 'string' ||
    typeof account !== 'object' ||
    account === null ||
    typeof account.userName !== 'string'
  ) {
    return null
  }
  const base: StoredBase = {
    v: 2,
    account: account as ConnectedAccount,
    connectedAt: r['connectedAt']
  }

  // v1 (Etapa 1): só token colado.
  if (r['v'] === 1) {
    return isNonEmpty(r['token']) ? { ...base, method: 'token', token: r['token'] } : null
  }
  if (r['v'] !== 2) return null
  if (r['method'] === 'token') {
    return isNonEmpty(r['token']) ? { ...base, method: 'token', token: r['token'] } : null
  }
  if (r['method'] === 'oauth' && isNonEmpty(r['accessToken']) && isNonEmpty(r['botId'])) {
    return {
      ...base,
      method: 'oauth',
      accessToken: r['accessToken'],
      refreshToken: isNonEmpty(r['refreshToken']) ? r['refreshToken'] : null,
      botId: r['botId'],
      workspaceId: isNonEmpty(r['workspaceId']) ? r['workspaceId'] : null
    }
  }
  return null
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

import { ApiError, isApiError } from '../../net/http'
import { isRecord } from '../../net/parse'
import { LoopbackAuthError } from '../../oauth/loopback'
import type { SecretStore } from '../../storage/secure-store'
import { StoredConnection, connectionMessages, errorStatus as error } from '../stored-connection'
import type { ConnectionStatus, OAuthConnector, OAuthCredentials, TokenCredentials } from '../types'
import {
  type NotionClient,
  type NotionListPage,
  type NotionQueryOptions,
  type NotionSelf
} from './notion.client'
import type { NotionOAuthBroker, NotionTokenSet } from './notion.oauth'
import { encodePropertyWrites, type PropertyWrites } from './notion.schema'
import type { AuthOptions, ConnectedAccount } from '../../../shared/connection'

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
  ...connectionMessages('Notion'),
  oauthUnavailable: 'O login com Notion não está disponível nesta versão do Orkio. Use um token.',
  oauthInProgress: 'Já existe uma conexão com o Notion em andamento. Conclua ou cancele.',
  oauthRevoked: 'A autorização do Notion expirou ou foi revogada. Conecte o Notion de novo.',
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
  /** Pessoa dona da conexão (GET /users/me), só em memória; zera ao conectar/desconectar. */
  private person: Promise<string | null> | null = null
  private readonly stored: StoredConnection<StoredNotionConnection>

  constructor(private readonly deps: NotionConnectorDeps) {
    this.now = deps.now ?? (() => new Date())
    this.stored = new StoredConnection({
      store: deps.store,
      key: 'notion',
      name: 'Notion',
      parse: parseStored,
      maxTokenLength: 1024
    })
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
    if (!this.stored.isAvailable()) return error(NOTION_MESSAGES.encryptionUnavailable)

    const controller = new AbortController()
    this.flow = controller
    try {
      let code: string
      try {
        ;({ code } = await oauth.authorize(controller.signal))
      } catch (e) {
        if (e instanceof LoopbackAuthError && e.code === 'cancelled') return this.getStatus()
        return this.stored.errorKeepingStored(
          e instanceof LoopbackAuthError ? e.message : NOTION_MESSAGES.unknown
        )
      }

      let tokens: NotionTokenSet
      try {
        tokens = await oauth.broker.exchangeCode(code, oauth.redirectUri)
      } catch (e) {
        return this.stored.errorKeepingStored(this.stored.messageFor(e))
      }
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
    this.person = null
    await this.stored.delete()
  }

  getStatus(): Promise<ConnectionStatus> {
    return this.stored.status()
  }

  testConnection(): Promise<ConnectionStatus> {
    return this.stored.revalidate(
      async (record) => {
        const result = await this.withAccessToken(record, (token) =>
          this.deps.client.getSelf(token)
        )
        return {
          ...result.record,
          account: mergeAccount(toAccount(result.value), result.record.account)
        }
      },
      (e, record) =>
        record.method === 'oauth' && e.code !== 'oauth_config'
          ? NOTION_MESSAGES.oauthRevoked
          : e.message
    )
  }

  /** Método da conexão salva, ou `null` se não houver. Sem rede. */
  async connectionMethod(): Promise<NotionConnectionMethod | null> {
    const loaded = await this.stored.load()
    return loaded.kind === 'ok' ? loaded.record.method : null
  }

  // ---------- Leituras usadas pelos serviços (o token nunca sai do conector) ----------

  /**
   * Id da pessoa do Notion dona da conexão (para filtrar as tarefas dela), ou `null` se a conexão
   * é de um bot do workspace. Lido uma vez por conexão; falha não fica em cache.
   */
  currentPersonId(): Promise<string | null> {
    if (!this.person) {
      const pending = this.callApi((token) => this.deps.client.getSelf(token)).then(
        (self) => self.personId
      )
      this.person = pending
      pending.catch(() => {
        if (this.person === pending) this.person = null
      })
    }
    return this.person
  }

  searchDataSources(options: { query?: string; startCursor?: string | null } = {}) {
    return this.callApi((token) => this.deps.client.searchDataSources(token, options))
  }

  getDataSource(id: string): Promise<unknown> {
    return this.callApi((token) => this.deps.client.getDataSource(token, id))
  }

  queryDataSource(id: string, options: NotionQueryOptions = {}): Promise<NotionListPage> {
    return this.callApi((token) => this.deps.client.queryDataSource(token, id, options))
  }

  updatePage(id: string, writes: PropertyWrites): Promise<void> {
    const properties = encodePropertyWrites(writes)
    return this.callApi((token) => this.deps.client.updatePage(token, id, properties))
  }

  getBlockChildren(id: string, startCursor?: string | null): Promise<NotionListPage> {
    return this.callApi((token) => this.deps.client.getBlockChildren(token, id, startCursor))
  }

  searchPages(query: string): Promise<NotionListPage> {
    return this.callApi((token) => this.deps.client.searchPages(token, query))
  }

  createChildPage(
    parentPageId: string,
    title: string,
    markdown: string
  ): Promise<{ id: string; url: string | null }> {
    return this.callApi((token) =>
      this.deps.client.createChildPage(token, parentPageId, title, markdown)
    )
  }

  appendMarkdown(pageId: string, markdown: string): Promise<void> {
    return this.callApi((token) => this.deps.client.appendMarkdown(token, pageId, markdown))
  }

  updateDataSource(id: string, properties: Record<string, unknown>): Promise<unknown> {
    return this.callApi((token) => this.deps.client.updateDataSource(token, id, properties))
  }

  private async callApi<T>(call: (token: string) => Promise<T>): Promise<T> {
    const loaded = await this.stored.load()
    if (loaded.kind !== 'ok') {
      throw new ApiError('notion', 'not_connected', NOTION_MESSAGES.notConnected)
    }
    try {
      return (await this.withAccessToken(loaded.record, call)).value
    } catch (e) {
      if (!isApiError(e)) {
        throw new ApiError('notion', 'unexpected', NOTION_MESSAGES.unknown)
      }
      if (e.code === 'unauthorized' || e.code === 'invalid_grant') {
        throw new ApiError(
          'notion',
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

  private async withAccessToken<T>(
    record: StoredNotionConnection,
    call: (accessToken: string) => Promise<T>
  ): Promise<{ value: T; record: StoredNotionConnection }> {
    if (record.method === 'token') return { value: await call(record.token), record }
    try {
      return { value: await call(record.accessToken), record }
    } catch (e) {
      if (!isApiError(e) || e.code !== 'unauthorized' || !record.refreshToken) {
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
        throw new ApiError('notion', 'invalid_grant', NOTION_MESSAGES.oauthRevoked)
      }
      const tokens = await oauth.broker.refresh(record.refreshToken)
      const renewed: StoredOAuth = {
        ...record,
        accessToken: tokens.accessToken,
        // O Notion devolve um refresh token novo a cada renovação.
        refreshToken: tokens.refreshToken ?? record.refreshToken,
        account: mergeAccount(accountFromTokens(tokens), record.account)
      }
      await this.stored.save(renewed)
      return renewed
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async connectWithToken(raw: string): Promise<ConnectionStatus> {
    const pasted = this.stored.pastedToken(raw)
    if (!pasted.ok) return pasted.status
    const { token } = pasted

    let self: NotionSelf
    try {
      self = await this.deps.client.getSelf(token)
    } catch (e) {
      return error(this.stored.messageFor(e))
    }

    this.person = null
    return this.stored.saveAndReport({
      v: 2,
      method: 'token',
      token,
      account: toAccount(self),
      connectedAt: this.now().toISOString()
    })
  }

  private async connectWithOAuthTokens(tokens: NotionTokenSet): Promise<ConnectionStatus> {
    if (!this.stored.isAvailable()) return error(NOTION_MESSAGES.encryptionUnavailable)

    let account = accountFromTokens(tokens)
    let warning: string | undefined
    try {
      account = mergeAccount(toAccount(await this.deps.client.getSelf(tokens.accessToken)), account)
    } catch (e) {
      if (this.stored.isRefusal(e)) return error(this.stored.messageFor(e))
      // Os tokens acabaram de ser emitidos: uma falha transitória aqui não impede salvar.
      warning = this.stored.messageFor(e)
    }

    this.person = null
    const status = await this.stored.saveAndReport({
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
}

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

export function accountFromTokens(tokens: NotionTokenSet): ConnectedAccount {
  const account: ConnectedAccount = { userName: tokens.ownerName ?? 'Usuário do Notion' }
  if (tokens.workspaceName) account.workspaceName = tokens.workspaceName
  const avatar = tokens.ownerAvatarUrl ?? tokens.workspaceIconUrl
  if (avatar) account.avatarUrl = avatar
  return account
}

function mergeAccount(fresh: ConnectedAccount, previous: ConnectedAccount): ConnectedAccount {
  const account: ConnectedAccount = { userName: fresh.userName || previous.userName }
  const workspaceName = fresh.workspaceName ?? previous.workspaceName
  const avatarUrl = fresh.avatarUrl ?? previous.avatarUrl
  if (workspaceName) account.workspaceName = workspaceName
  if (avatarUrl) account.avatarUrl = avatarUrl
  return account
}

function parseStored(value: unknown): StoredNotionConnection | null {
  if (!isRecord(value)) return null
  const r = value
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

import { ApiError, isTransientApiError, requestJson } from '../../net/http'
import { isRecord } from '../../net/parse'
import { DeviceFlowError, pollDeviceToken, type DeviceAuthorization } from '../../oauth/device-flow'
import type { SecretStore } from '../../storage/secure-store'
import { StoredConnection, connectionMessages, errorStatus as error } from '../stored-connection'
import type {
  ConnectionStatus,
  DeviceFlowConnector,
  DeviceFlowStartResult,
  OAuthCredentials,
  TokenCredentials
} from '../types'
import {
  type ConditionalPage,
  type GitHubClient,
  type GitHubRepo,
  type GitHubUser
} from './github.client'
import type { GitHubDeviceApi, GitHubOAuthToken } from './github.oauth'
import { isAllowedSiteOrigin } from '../../platform/site'
import type { AuthOptions, ConnectedAccount, DeviceFlowInfo } from '../../../shared/connection'
import { isLogin, isOwner, isRepo, isTeamSlug } from '../../../shared/github-names'
import type { PublishReviewEvent } from '../../../shared/review-publish'

const DISCONNECTED: ConnectionStatus = { state: 'disconnected' }

export type GitHubCredentials = TokenCredentials | OAuthCredentials<GitHubOAuthToken>

/** O que fica salvo (criptografado) no disco. */
interface StoredGitHubConnection {
  v: 1
  method: 'device' | 'token'
  token: string
  /** Escopos concedidos (null para fine-grained PAT). */
  scopes: string[] | null
  account: ConnectedAccount
  connectedAt: string
}

export const GITHUB_MESSAGES = {
  ...connectionMessages('GitHub'),
  oauthUnavailable: 'O login com GitHub não está disponível nesta versão do Orkio. Use um token.',
  deviceExpired: 'O código expirou antes da autorização. Clique em “Conectar com GitHub” de novo.',
  deviceDenied: 'Você cancelou a autorização no GitHub. Nada foi conectado.',
  deviceRevoked: 'A autorização do GitHub foi revogada. Conecte o GitHub de novo.'
} as const

export interface GitHubConnectorDeps {
  store: SecretStore
  client: GitHubClient
  /** Ausente quando o build não tem client ID da OAuth App. */
  device?: GitHubDeviceApi | null
  now?: () => Date
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Client ID da OAuth App (público): monta o link das configurações de acesso da conta. */
  oauthClientId?: string | null
  /** fetch para o site do Orkio (revisão como orkio[bot]); padrão: o global, na hora da chamada. */
  fetch?: typeof fetch
  /** Prazo do POST da revisão ao site (padrão `ORKIO_SITE_TIMEOUT_MS`; menor nos testes). */
  siteTimeoutMs?: number
  /**
   * Origem do site do Orkio (`siteOrigin()`, `platform/site.ts`), fixada na construção: é o ÚNICO destino
   * possível do token do usuário fora do GitHub. `null`/ausente → revisão como orkio[bot]
   * indisponível (`no_site`).
   */
  siteOrigin?: string | null
  /** `http://127.0.0.1` como site do Orkio: nunca em build de produção (`allowsLoopbackSite`). */
  allowLoopbackSite?: boolean
}

/** Maior que o prazo total do site (15 s): o app não desiste enquanto o site ainda posta. */
export const ORKIO_SITE_TIMEOUT_MS = 25_000
export const ORKIO_SITE_TIMEOUT_MESSAGE =
  'O site do Orkio demorou para responder. Confira a PR antes de tentar de novo: a revisão pode ' +
  'ter sido publicada.'
/** Consulta da instalação do orkio[bot]: o site responde em até 15 s; aqui, 20. */
export const ORKIO_SITE_QUERY_TIMEOUT_MS = 20_000
const ORKIO_SITE_MAX_RESPONSE_BYTES = 64 * 1024
export const NO_SITE_MESSAGE =
  'Este app não sabe o endereço do site do Orkio (MAIN_VITE_SITE_URL não definido no build). ' +
  'Em dev, defina em .env.development e reinicie o pnpm dev.'

/** O que o `GitHubReviewPoster` manda ao site (o token do usuário é acrescentado pelo conector). */
export interface OrkioSiteReviewPayload {
  owner: string
  repo: string
  number: number
  review: {
    event: PublishReviewEvent
    body: string
    comments: { path: string; line: number; side: 'RIGHT'; body: string }[]
  }
}

export interface OrkioSiteResponse {
  status: number
  /** JSON da resposta (lido com limite); `null` se vazio, grande demais ou inválido. */
  body: unknown
}

interface ActiveDeviceFlow {
  info: DeviceFlowInfo
  controller: AbortController
  result: Promise<ConnectionStatus>
}

export class GitHubConnector implements DeviceFlowConnector<GitHubCredentials> {
  readonly id = 'github' as const
  private readonly now: () => Date
  private flow: ActiveDeviceFlow | null = null
  private readonly stored: StoredConnection<StoredGitHubConnection>

  constructor(private readonly deps: GitHubConnectorDeps) {
    this.now = deps.now ?? (() => new Date())
    this.stored = new StoredConnection({
      store: deps.store,
      key: 'github',
      name: 'GitHub',
      parse: parseStored,
      maxTokenLength: 512
    })
  }

  getAuthOptions(): AuthOptions {
    return { oauth: Boolean(this.deps.device) }
  }

  async connect(credentials: GitHubCredentials): Promise<ConnectionStatus> {
    return credentials.kind === 'oauth'
      ? this.connectWithDeviceToken(credentials.tokens)
      : this.connectWithToken(credentials.token)
  }

  async startDeviceFlow(): Promise<DeviceFlowStartResult> {
    const device = this.deps.device
    if (!device) return { ok: false, status: error(GITHUB_MESSAGES.oauthUnavailable) }
    // Renderer recarregou no meio do fluxo: devolve o mesmo código.
    if (this.flow) return { ok: true, flow: this.flow.info }
    if (!this.stored.isAvailable()) {
      return { ok: false, status: error(GITHUB_MESSAGES.encryptionUnavailable) }
    }

    let authorization: DeviceAuthorization
    try {
      authorization = await device.requestCode()
    } catch (e) {
      return { ok: false, status: await this.stored.errorKeepingStored(this.stored.messageFor(e)) }
    }
    if (this.flow) return { ok: true, flow: (this.flow as ActiveDeviceFlow).info }

    const startedAt = this.now().getTime()
    const controller = new AbortController()
    const info: DeviceFlowInfo = {
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      expiresAt: new Date(startedAt + authorization.expiresInSec * 1000).toISOString()
    }

    const flow: ActiveDeviceFlow = { info, controller, result: Promise.resolve(DISCONNECTED) }
    this.flow = flow
    flow.result = this.runDeviceFlow(flow, device, authorization, startedAt)
    return { ok: true, flow: info }
  }

  /** Polling até o desfecho. Nunca rejeita: todo resultado vira ConnectionStatus. */
  private async runDeviceFlow(
    flow: ActiveDeviceFlow,
    device: GitHubDeviceApi,
    authorization: DeviceAuthorization,
    startedAt: number
  ): Promise<ConnectionStatus> {
    const { signal } = flow.controller
    try {
      const token = await pollDeviceToken({
        authorization,
        poll: (code) => device.pollToken(code),
        isTransientError: (e) => isTransientApiError(e, 'github'),
        signal,
        startedAt,
        now: () => this.now().getTime(),
        ...(this.deps.sleep ? { sleep: this.deps.sleep } : {})
      })
      if (signal.aborted) return await this.getStatus()
      return await this.connectWithDeviceToken(token)
    } catch (e) {
      if (e instanceof DeviceFlowError) {
        if (e.code === 'cancelled') return await this.getStatus()
        return await this.stored.errorKeepingStored(
          e.code === 'expired' ? GITHUB_MESSAGES.deviceExpired : GITHUB_MESSAGES.deviceDenied
        )
      }
      return await this.stored.errorKeepingStored(this.stored.messageFor(e))
    } finally {
      if (this.flow === flow) this.flow = null
    }
  }

  async waitDeviceFlow(): Promise<ConnectionStatus> {
    return this.flow ? this.flow.result : this.getStatus()
  }

  cancelDeviceFlow(): void {
    this.flow?.controller.abort()
  }

  /** O build tem a origem do site do Orkio (revisão como orkio[bot])? Sem rede. */
  hasOrkioSite(): boolean {
    const origin = this.deps.siteOrigin
    return Boolean(origin && isAllowedSiteOrigin(origin, this.deps.allowLoopbackSite === true))
  }

  /** Há conta conectada (credencial salva e legível)? Sem rede. */
  async isConnected(): Promise<boolean> {
    return (await this.stored.load()).kind === 'ok'
  }

  /**
   * Dados do repositório com a conta conectada (branch padrão, visibilidade, push, arquivado).
   * Lança `ApiError` do GitHub (`not_connected`, `not_found`, `sso_required`, `oauth_restricted`, ...).
   */
  async getRepository(owner: string, name: string): Promise<GitHubRepo> {
    return this.withAccessToken((token) => this.deps.client.getRepository(token, owner, name))
  }

  /**
   * GET condicional (ETag) de uma página da API de repositórios, para os sinais da 2D.
   * Só caminhos de repositório; o token nunca sai do conector.
   */
  async getConditional(path: string, etag: string | null): Promise<ConditionalPage> {
    if (!/^\/(repos|repositories)\//.test(path)) {
      throw new ApiError('github', 'unexpected', 'Caminho da API do GitHub não permitido.')
    }
    return this.withAccessToken((token) => this.deps.client.getConditional(token, path, etag))
  }

  async graphql(
    query: string,
    variables: Record<string, unknown>
  ): Promise<{ data: unknown; errors: { type: string | null; path: string[] }[] }> {
    return this.withAccessToken((token) => this.deps.client.graphql(token, query, variables))
  }

  /**
   * Pede review numa PR (5C, ação "Pedir review" de um fluxo, sempre depois de um gate). Única
   * escrita do conector: caminho montado aqui (owner/repo/número validados), o token não sai.
   */
  async requestReviewers(
    owner: string,
    repo: string,
    pull: number,
    reviewers: { users: string[]; teams: string[] }
  ): Promise<void> {
    if (
      !isOwner(owner) ||
      !isRepo(repo) ||
      !Number.isSafeInteger(pull) ||
      pull <= 0 ||
      reviewers.users.length + reviewers.teams.length === 0 ||
      !reviewers.users.every(isLogin) ||
      !reviewers.teams.every(isTeamSlug)
    ) {
      throw new ApiError('github', 'unexpected', 'Pedido de review inválido.')
    }
    return this.withAccessToken((token) =>
      this.deps.client.requestReviewers(token, owner, repo, pull, reviewers)
    )
  }

  async listCollaborators(owner: string, repo: string): Promise<string[]> {
    if (!isOwner(owner) || !isRepo(repo)) return []
    return this.withAccessToken((token) => this.deps.client.listCollaborators(token, owner, repo))
  }

  /**
   * Onde a pessoa revisa/pede acesso de organizações para o Orkio:
   * OAuth App → página da autorização do app; token colado → página de fine-grained PATs.
   */
  async accessSettingsUrl(): Promise<string> {
    const loaded = await this.stored.load()
    if (loaded.kind === 'ok' && loaded.record.method === 'device' && this.deps.oauthClientId) {
      return `https://github.com/settings/connections/applications/${encodeURIComponent(this.deps.oauthClientId)}`
    }
    return 'https://github.com/settings/personal-access-tokens'
  }

  /**
   * Revisão publicada como `orkio[bot]`: manda a revisão ao site do PRÓPRIO Orkio
   * (`POST <origem>/github/review`), que confere o push com o token do usuário e posta com o
   * GitHub App. Tempo esgotado = "a revisão pode ter sido publicada" (o site pode estar postando).
   */
  async postReviewViaOrkioSite(payload: OrkioSiteReviewPayload): Promise<OrkioSiteResponse> {
    return this.callOrkioSite(
      '/github/review',
      (token) => ({
        owner: payload.owner,
        repo: payload.repo,
        number: payload.number,
        userToken: token,
        review: payload.review
      }),
      {
        timeoutMs: this.deps.siteTimeoutMs ?? ORKIO_SITE_TIMEOUT_MS,
        timeoutMessage: ORKIO_SITE_TIMEOUT_MESSAGE
      }
    )
  }

  /**
   * O orkio[bot] está instalado neste repositório? Só leitura, pelo site do Orkio
   * (`POST <origem>/github/installation`), que confere com o token do usuário que ele enxerga o
   * repositório e consulta a instalação com o JWT do App. Prazo menor (é só uma consulta).
   */
  async orkioBotInstallation(owner: string, repo: string): Promise<OrkioSiteResponse> {
    if (!isOwner(owner) || !isRepo(repo)) {
      throw new ApiError('github', 'unexpected', 'Repositório inválido.')
    }
    return this.callOrkioSite(
      '/github/installation',
      (token) => ({ owner, repo, userToken: token }),
      { timeoutMs: ORKIO_SITE_QUERY_TIMEOUT_MS }
    )
  }

  /**
   * POST ao site do PRÓPRIO Orkio com o token do usuário no corpo. Única saída do token para fora
   * do GitHub: a requisição é montada AQUI (nunca entregue a um callback), só para a origem fixada
   * na construção (`deps.siteOrigin`, conferida por `isAllowedSiteOrigin`: https;
   * http://127.0.0.1 nunca em produção), sem seguir redirecionamento, com timeout que cobre a
   * leitura do corpo. Devolve só o status e o JSON da resposta do site (que nunca ecoa o token).
   * Erros (`ApiError` do serviço `site`): `no_site` (sem origem ou origem recusada), `network`,
   * `timeout`; e `not_connected` do GitHub.
   */
  private async callOrkioSite(
    path: '/github/review' | '/github/installation',
    body: (token: string) => Record<string, unknown>,
    options: { timeoutMs: number; timeoutMessage?: string }
  ): Promise<OrkioSiteResponse> {
    const siteOrigin = this.deps.siteOrigin
    if (!siteOrigin || !isAllowedSiteOrigin(siteOrigin, this.deps.allowLoopbackSite === true)) {
      throw new ApiError('site', 'no_site', NO_SITE_MESSAGE)
    }
    const host = new URL(siteOrigin).host
    return this.withAccessToken(async (token) => {
      const response = await requestJson(
        {
          url: `${siteOrigin}${path}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body(token)),
          // Nunca seguir redirecionamento: o corpo (com o token) iria para outro endereço.
          redirect: 'error'
        },
        {
          service: 'site',
          label: `o site do Orkio (${host})`,
          fetch: this.deps.fetch,
          timeoutMs: options.timeoutMs,
          maxBodyBytes: ORKIO_SITE_MAX_RESPONSE_BYTES,
          ...(options.timeoutMessage ? { messages: { timeout: options.timeoutMessage } } : {})
        }
      )
      return { status: response.status, body: response.body }
    })
  }

  /**
   * Executa uma chamada à API com o token salvo, sem expô-lo fora do conector.
   * Tokens de OAuth App não expiram: não há renovação; 401 sobe como `unauthorized`.
   */
  private async withAccessToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    const loaded = await this.stored.load()
    if (loaded.kind !== 'ok') {
      throw new ApiError('github', 'not_connected', GITHUB_MESSAGES.notConnected)
    }
    return call(loaded.record.token)
  }

  async disconnect(): Promise<void> {
    this.cancelDeviceFlow()
    await this.stored.delete()
  }

  getStatus(): Promise<ConnectionStatus> {
    return this.stored.status()
  }

  testConnection(): Promise<ConnectionStatus> {
    return this.stored.revalidate(
      async (record) => {
        const user = await this.deps.client.getUser(record.token)
        return { ...record, account: toAccount(user), scopes: user.scopes ?? record.scopes }
      },
      (e, record) =>
        record.method === 'device' && e.code === 'unauthorized'
          ? GITHUB_MESSAGES.deviceRevoked
          : e.message
    )
  }

  private async connectWithToken(raw: string): Promise<ConnectionStatus> {
    const pasted = this.stored.pastedToken(raw)
    if (!pasted.ok) return pasted.status
    const { token } = pasted

    let user: GitHubUser
    try {
      user = await this.deps.client.getUser(token)
    } catch (e) {
      return error(this.stored.messageFor(e))
    }
    return this.stored.saveAndReport({
      v: 1,
      method: 'token',
      token,
      scopes: user.scopes,
      account: toAccount(user),
      connectedAt: this.now().toISOString()
    })
  }

  private async connectWithDeviceToken(token: GitHubOAuthToken): Promise<ConnectionStatus> {
    if (!this.stored.isAvailable()) return error(GITHUB_MESSAGES.encryptionUnavailable)
    let user: GitHubUser
    try {
      user = await this.deps.client.getUser(token.accessToken)
    } catch (e) {
      // Sem /user não sabemos quem é a conta; como o token é novo, pedimos para tentar de novo.
      return this.stored.errorKeepingStored(this.stored.messageFor(e))
    }
    return this.stored.saveAndReport({
      v: 1,
      method: 'device',
      token: token.accessToken,
      scopes: token.scopes.length > 0 ? token.scopes : user.scopes,
      account: toAccount(user),
      connectedAt: this.now().toISOString()
    })
  }
}

export function toAccount(user: GitHubUser): ConnectedAccount {
  const account: ConnectedAccount = { userName: user.name ?? user.login, handle: user.login }
  if (user.avatarUrl) account.avatarUrl = user.avatarUrl
  return account
}

function parseStored(value: unknown): StoredGitHubConnection | null {
  if (!isRecord(value)) return null
  const r = value
  const account = r['account'] as Partial<ConnectedAccount> | null | undefined
  if (
    r['v'] !== 1 ||
    (r['method'] !== 'device' && r['method'] !== 'token') ||
    typeof r['token'] !== 'string' ||
    r['token'] === '' ||
    typeof r['connectedAt'] !== 'string' ||
    typeof account !== 'object' ||
    account === null ||
    typeof account.userName !== 'string'
  ) {
    return null
  }
  const scopes = Array.isArray(r['scopes'])
    ? r['scopes'].filter((s): s is string => typeof s === 'string')
    : null
  return {
    v: 1,
    method: r['method'],
    token: r['token'],
    scopes,
    account: account as ConnectedAccount,
    connectedAt: r['connectedAt']
  }
}

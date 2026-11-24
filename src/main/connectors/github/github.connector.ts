import type { AuthOptions, ConnectedAccount, DeviceFlowInfo } from '../../../shared/ipc-contract'
import { DeviceFlowError, pollDeviceToken, type DeviceAuthorization } from '../../oauth/device-flow'
import { EncryptionUnavailableError, type SecretStore } from '../../storage/secure-store'
import type {
  ConnectionStatus,
  DeviceFlowConnector,
  DeviceFlowStartResult,
  OAuthCredentials,
  TokenCredentials
} from '../types'
import {
  GitHubApiError,
  isTransientGitHubError,
  type ConditionalPage,
  type GitHubClient,
  type GitHubRepo,
  type GitHubUser
} from './github.client'
import type { GitHubDeviceApi, GitHubOAuthToken } from './github.oauth'
import { isAllowedOrkioSiteOrigin } from './orkio-site'

const SECRET_KEY = 'github'
const DISCONNECTED: ConnectionStatus = { state: 'disconnected' }
const MAX_TOKEN_LENGTH = 512

/** owner, repo, login ou slug de time: sem barras, sem espaços. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

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
  emptyToken: 'Cole o token do GitHub para conectar.',
  malformedToken: 'Esse token não parece válido. Copie o token completo, sem espaços.',
  encryptionUnavailable:
    'Seu sistema não oferece armazenamento seguro de credenciais (keychain/keyring). ' +
    'O token não foi salvo. No Linux, instale e desbloqueie o GNOME Keyring ou o KWallet.',
  storageReadFailed:
    'Não foi possível ler a conexão salva com o GitHub. Desconecte e conecte novamente.',
  storageWriteFailed: 'Não foi possível salvar a conexão com o GitHub. Tente novamente.',
  unknown: 'Algo deu errado ao falar com o GitHub. Tente novamente.',
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
  /** Injetável para testes do polling. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Client ID da OAuth App (público): monta o link das configurações de acesso da conta. */
  oauthClientId?: string | null
  /** fetch para o site do Orkio (revisão como orkio[bot]); padrão: o global, na hora da chamada. */
  fetch?: typeof fetch
  siteTimeoutMs?: number
  /**
   * Origem do site do Orkio (`readOrkioSiteOrigin`), fixada na construção: é o ÚNICO destino
   * possível do token do usuário fora do GitHub. `null`/ausente → revisão como orkio[bot]
   * indisponível (`not_configured`).
   */
  siteOrigin?: string | null
  /** `http://127.0.0.1` como site do Orkio: só em build de E2E. */
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
/** Começo da mensagem de erro de rede do POST ao site (o passo do fluxo reconhece por ele). */
export const ORKIO_SITE_NETWORK_PREFIX = 'Não foi possível falar com o site do Orkio'

/** O que o `GitHubReviewPoster` manda ao site (o token do usuário é acrescentado pelo conector). */
export interface OrkioSiteReviewPayload {
  owner: string
  repo: string
  number: number
  review: {
    event: 'COMMENT' | 'REQUEST_CHANGES'
    body: string
    comments: { path: string; line: number; side: 'RIGHT'; body: string }[]
  }
}

export interface OrkioSiteResponse {
  status: number
  /** JSON da resposta (lido com limite); `null` se vazio, grande demais ou inválido. */
  body: unknown
}

/**
 * Corpo da resposta até `max` bytes (passou disso → ''). O timeout (`signal`) vale também aqui:
 * abortou durante a leitura → lança.
 */
async function readLimitedText(
  response: Response,
  max: number,
  signal: AbortSignal
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const onAbort = (): void => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw new Error('aborted')
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => undefined)
        return ''
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
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

  constructor(private readonly deps: GitHubConnectorDeps) {
    this.now = deps.now ?? (() => new Date())
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
    if (!this.deps.store.isAvailable()) {
      return { ok: false, status: error(GITHUB_MESSAGES.encryptionUnavailable) }
    }

    let authorization: DeviceAuthorization
    try {
      authorization = await device.requestCode()
    } catch (e) {
      return { ok: false, status: await this.errorKeepingStored(messageFor(e)) }
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
        isTransientError: isTransientGitHubError,
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
        return await this.errorKeepingStored(
          e.code === 'expired' ? GITHUB_MESSAGES.deviceExpired : GITHUB_MESSAGES.deviceDenied
        )
      }
      return await this.errorKeepingStored(messageFor(e))
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
    return Boolean(origin && isAllowedOrkioSiteOrigin(origin, this.deps.allowLoopbackSite === true))
  }

  /** Há conta conectada (credencial salva e legível)? Sem rede. */
  async isConnected(): Promise<boolean> {
    return (await this.load()).kind === 'ok'
  }

  /**
   * Dados do repositório com a conta conectada (branch padrão, visibilidade, push, arquivado).
   * Lança GitHubApiError (`not_connected`, `not_found`, `sso_required`, `oauth_restricted`, ...).
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
      throw new GitHubApiError('unexpected', 'Caminho da API do GitHub não permitido.')
    }
    return this.withAccessToken((token) => this.deps.client.getConditional(token, path, etag))
  }

  /** Consulta GraphQL (detalhes de PRs: revisão, threads, checks). */
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
      !SLUG.test(owner) ||
      !SLUG.test(repo) ||
      !Number.isSafeInteger(pull) ||
      pull <= 0 ||
      reviewers.users.length + reviewers.teams.length === 0 ||
      ![...reviewers.users, ...reviewers.teams].every((r) => SLUG.test(r))
    ) {
      throw new GitHubApiError('unexpected', 'Pedido de review inválido.')
    }
    return this.withAccessToken((token) =>
      this.deps.client.requestReviewers(token, owner, repo, pull, reviewers)
    )
  }

  /** Colaboradores do repositório (sugestão de revisores). */
  async listCollaborators(owner: string, repo: string): Promise<string[]> {
    if (!SLUG.test(owner) || !SLUG.test(repo)) return []
    return this.withAccessToken((token) => this.deps.client.listCollaborators(token, owner, repo))
  }

  /**
   * Onde a pessoa revisa/pede acesso de organizações para o Orkio:
   * OAuth App → página da autorização do app; token colado → página de fine-grained PATs.
   */
  async accessSettingsUrl(): Promise<string> {
    const loaded = await this.load()
    if (loaded.kind === 'ok' && loaded.record.method === 'device' && this.deps.oauthClientId) {
      return `https://github.com/settings/connections/applications/${encodeURIComponent(this.deps.oauthClientId)}`
    }
    return 'https://github.com/settings/personal-access-tokens'
  }

  /**
   * Revisão publicada como `orkio[bot]`: manda a revisão ao site do PRÓPRIO Orkio
   * (`POST <origem>/github/review`), que confere o push com o token do usuário e posta com o
   * GitHub App. Única saída do token do usuário para fora do GitHub: a requisição é montada AQUI
   * (nunca entregue a um callback), só para a origem fixada na construção (`deps.siteOrigin`,
   * conferida por `isAllowedOrkioSiteOrigin`: https; http://127.0.0.1 só em build de E2E), sem
   * seguir redirecionamento, com timeout que cobre a leitura do corpo. Devolve só o status e o JSON
   * da resposta do site (que nunca ecoa o token).
   * Erros: `not_configured` (sem origem ou origem recusada), `not_connected`, `network`, `timeout`.
   */
  async postReviewViaOrkioSite(payload: OrkioSiteReviewPayload): Promise<OrkioSiteResponse> {
    return this.callOrkioSite('/github/review', (token) => ({
      owner: payload.owner,
      repo: payload.repo,
      number: payload.number,
      userToken: token,
      review: payload.review
    }))
  }

  /**
   * O orkio[bot] está instalado neste repositório? Só leitura, pelo site do Orkio
   * (`POST <origem>/github/installation`), que confere com o token do usuário que ele enxerga o
   * repositório e consulta a instalação com o JWT do App. Mesmas regras de destino, timeout e
   * erros do `postReviewViaOrkioSite`; prazo menor (é só uma consulta).
   */
  async orkioBotInstallation(owner: string, repo: string): Promise<OrkioSiteResponse> {
    if (!SLUG.test(owner) || !SLUG.test(repo)) {
      throw new GitHubApiError('unexpected', 'Repositório inválido.')
    }
    return this.callOrkioSite(
      '/github/installation',
      (token) => ({ owner, repo, userToken: token }),
      ORKIO_SITE_QUERY_TIMEOUT_MS
    )
  }

  /**
   * POST ao site do PRÓPRIO Orkio com o token do usuário no corpo. Única saída do token para fora
   * do GitHub: a requisição é montada AQUI (nunca entregue a um callback), só para a origem fixada
   * na construção (`deps.siteOrigin`, conferida por `isAllowedOrkioSiteOrigin`: https;
   * http://127.0.0.1 só em build de E2E), sem seguir redirecionamento, com timeout que cobre a
   * leitura do corpo. Devolve só o status e o JSON da resposta do site (que nunca ecoa o token).
   * Erros: `not_configured` (sem origem ou origem recusada), `not_connected`, `network`, `timeout`.
   */
  private async callOrkioSite(
    path: '/github/review' | '/github/installation',
    body: (token: string) => Record<string, unknown>,
    timeoutOverrideMs?: number
  ): Promise<OrkioSiteResponse> {
    const siteOrigin = this.deps.siteOrigin
    if (
      !siteOrigin ||
      !isAllowedOrkioSiteOrigin(siteOrigin, this.deps.allowLoopbackSite === true)
    ) {
      throw new GitHubApiError(
        'not_configured',
        'Este app não sabe o endereço do site do Orkio (MAIN_VITE_SITE_URL não definido no build).'
      )
    }
    const host = new URL(siteOrigin).host
    const doFetch: typeof fetch = (...args) => (this.deps.fetch ?? globalThis.fetch)(...args)
    const timeoutMs = this.deps.siteTimeoutMs ?? timeoutOverrideMs ?? ORKIO_SITE_TIMEOUT_MS
    return this.withAccessToken(async (token) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await doFetch(`${siteOrigin}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body(token)),
          // Nunca seguir redirecionamento: o corpo (com o token) iria para outro endereço.
          redirect: 'error',
          signal: controller.signal
        })
        const text = await readLimitedText(
          response,
          ORKIO_SITE_MAX_RESPONSE_BYTES,
          controller.signal
        )
        let parsed: unknown = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = null
        }
        return { status: response.status, body: parsed }
      } catch {
        // Exceção original descartada (pode carregar detalhes da requisição).
        throw controller.signal.aborted
          ? new GitHubApiError(
              'timeout',
              path === '/github/review'
                ? ORKIO_SITE_TIMEOUT_MESSAGE
                : 'O site do Orkio demorou para responder. Tente de novo.'
            )
          : new GitHubApiError(
              'network',
              `${ORKIO_SITE_NETWORK_PREFIX} (${host}). Verifique sua internet e tente de novo.`
            )
      } finally {
        clearTimeout(timer)
      }
    })
  }

  /**
   * Executa uma chamada à API com o token salvo, sem expô-lo fora do conector.
   * Tokens de OAuth App não expiram: não há renovação; 401 sobe como `unauthorized`.
   */
  private async withAccessToken<T>(call: (token: string) => Promise<T>): Promise<T> {
    const loaded = await this.load()
    if (loaded.kind !== 'ok') {
      throw new GitHubApiError(
        'not_connected',
        'Conecte sua conta do GitHub em Integrações para continuar.'
      )
    }
    return call(loaded.record.token)
  }

  async disconnect(): Promise<void> {
    this.cancelDeviceFlow()
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

    let user: GitHubUser
    try {
      user = await this.deps.client.getUser(record.token)
    } catch (e) {
      if (isTerminalAuthError(e)) {
        const message =
          record.method === 'device' && (e as GitHubApiError).code === 'unauthorized'
            ? GITHUB_MESSAGES.deviceRevoked
            : (e as GitHubApiError).message
        // Mantém o arquivo até o usuário desconectar ou reconectar.
        return { state: 'error', message, hasStoredCredentials: true }
      }
      // Falha transitória (rede, 5xx, rate limit): continua conectado, com aviso.
      return { ...connected(record), warning: messageFor(e) }
    }

    const refreshed: StoredGitHubConnection = {
      ...record,
      account: toAccount(user),
      scopes: user.scopes ?? record.scopes
    }
    try {
      await this.save(refreshed)
    } catch {
      // Falha ao atualizar dados de exibição não invalida a conexão.
    }
    return connected(refreshed)
  }

  private async connectWithToken(raw: string): Promise<ConnectionStatus> {
    const token = raw.trim()
    if (token === '') return error(GITHUB_MESSAGES.emptyToken)
    if (token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
      return error(GITHUB_MESSAGES.malformedToken)
    }
    if (!this.deps.store.isAvailable()) return error(GITHUB_MESSAGES.encryptionUnavailable)

    let user: GitHubUser
    try {
      user = await this.deps.client.getUser(token)
    } catch (e) {
      return error(messageFor(e))
    }
    return this.saveAndReport({
      v: 1,
      method: 'token',
      token,
      scopes: user.scopes,
      account: toAccount(user),
      connectedAt: this.now().toISOString()
    })
  }

  private async connectWithDeviceToken(token: GitHubOAuthToken): Promise<ConnectionStatus> {
    if (!this.deps.store.isAvailable()) return error(GITHUB_MESSAGES.encryptionUnavailable)
    let user: GitHubUser
    try {
      user = await this.deps.client.getUser(token.accessToken)
    } catch (e) {
      // Sem /user não sabemos quem é a conta; como o token é novo, pedimos para tentar de novo.
      return this.errorKeepingStored(messageFor(e))
    }
    return this.saveAndReport({
      v: 1,
      method: 'device',
      token: token.accessToken,
      scopes: token.scopes.length > 0 ? token.scopes : user.scopes,
      account: toAccount(user),
      connectedAt: this.now().toISOString()
    })
  }

  private async saveAndReport(record: StoredGitHubConnection): Promise<ConnectionStatus> {
    try {
      await this.save(record)
    } catch (e) {
      return error(
        e instanceof EncryptionUnavailableError
          ? GITHUB_MESSAGES.encryptionUnavailable
          : GITHUB_MESSAGES.storageWriteFailed
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

  private async save(record: StoredGitHubConnection): Promise<void> {
    await this.deps.store.set(SECRET_KEY, JSON.stringify(record))
  }

  private async load(): Promise<
    | { kind: 'none' }
    | { kind: 'ok'; record: StoredGitHubConnection }
    | { kind: 'error'; status: ConnectionStatus }
  > {
    let raw: string | null
    try {
      raw = await this.deps.store.get(SECRET_KEY)
    } catch (e) {
      const message =
        e instanceof EncryptionUnavailableError
          ? GITHUB_MESSAGES.encryptionUnavailable
          : GITHUB_MESSAGES.storageReadFailed
      return { kind: 'error', status: { state: 'error', message, hasStoredCredentials: true } }
    }
    if (raw === null) return { kind: 'none' }
    const record = parseStored(raw)
    if (!record) {
      return {
        kind: 'error',
        status: {
          state: 'error',
          message: GITHUB_MESSAGES.storageReadFailed,
          hasStoredCredentials: true
        }
      }
    }
    return { kind: 'ok', record }
  }
}

export function toAccount(user: GitHubUser): ConnectedAccount {
  const account: ConnectedAccount = { userName: user.name ?? user.login, handle: user.login }
  if (user.avatarUrl) account.avatarUrl = user.avatarUrl
  return account
}

type ConnectedStatus = Extract<ConnectionStatus, { state: 'connected' }>

function connected(record: StoredGitHubConnection): ConnectedStatus {
  return { state: 'connected', account: record.account, connectedAt: record.connectedAt }
}

function error(message: string): ConnectionStatus {
  return { state: 'error', message }
}

function messageFor(e: unknown): string {
  return e instanceof GitHubApiError ? e.message : GITHUB_MESSAGES.unknown
}

/** Erros que exigem ação do usuário (novo token / reconectar), não só tentar de novo. */
function isTerminalAuthError(e: unknown): boolean {
  return (
    e instanceof GitHubApiError &&
    (e.code === 'unauthorized' || e.code === 'forbidden' || e.code === 'oauth_config')
  )
}

function parseStored(raw: string): StoredGitHubConnection | null {
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

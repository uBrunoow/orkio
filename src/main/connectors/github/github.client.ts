/**
 * Cliente HTTP mínimo da API REST do GitHub. Roda só no processo main.
 * fetch nativo (mesmo motivo do Notion): poucos endpoints, controle de timeout e rate limit.
 */
import { httpsUrlOrNull, isRecord, parseRetryAfterMs, stringOrNull } from '../../net/parse'

export const GITHUB_API_BASE_URL = 'https://api.github.com'
/** Versão da API REST (header X-GitHub-Api-Version). Atualize só aqui. */
export const GITHUB_API_VERSION = '2026-03-10'
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000
/** Esperamos e repetimos uma vez se o GitHub pedir até este tempo; acima disso, erro. */
export const GITHUB_MAX_RETRY_WAIT_MS = 5_000
/** Rate limit secundário sem Retry-After: a documentação pede ao menos 1 minuto. */
export const GITHUB_SECONDARY_RATE_LIMIT_DEFAULT_MS = 60_000
export const GITHUB_USER_AGENT = 'Orkio-Desktop'

export type GitHubErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unexpected'
  /** Device Flow: app sem Device Flow habilitado ou client ID inválido. */
  | 'oauth_config'
  /** 404: o repositório não existe ou a conta não tem acesso (o GitHub não diferencia). */
  | 'not_found'
  /** 403 com X-GitHub-SSO: a org exige autorização SAML SSO para este token. */
  | 'sso_required'
  /** 403 por restrição de OAuth Apps da org: um owner precisa aprovar o Orkio. */
  | 'oauth_restricted'
  /** Nenhuma conta do GitHub conectada no Orkio. */
  | 'not_connected'

/** Erro com mensagem segura para o usuário (pt-BR). Nunca contém o token nem a exceção original. */
export class GitHubApiError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
    readonly status?: number,
    /** Dados extras seguros para a UI (ex.: URL de autorização SSO do próprio GitHub). */
    readonly details: { ssoUrl?: string; org?: string } = {}
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

/** Erros que não encerram um polling (podem passar sozinhos). */
export function isTransientGitHubError(error: unknown): boolean {
  return (
    error instanceof GitHubApiError &&
    (error.code === 'network' || error.code === 'timeout' || error.code === 'server')
  )
}

export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
  /** Escopos do token (header X-OAuth-Scopes). `null` para fine-grained PATs, que não o enviam. */
  scopes: string[] | null
}

export interface GitHubRepo {
  owner: string
  name: string
  defaultBranch: string
  visibility: 'public' | 'private' | 'internal'
  archived: boolean
  /** Permissão de push da conta conectada. */
  canPush: boolean
}

export interface GitHubClientDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  now?: () => number
}

export interface GitHubClient {
  getUser(token: string): Promise<GitHubUser>
  getRepository(token: string, owner: string, name: string): Promise<GitHubRepo>
}

export function createGitHubClient(deps: GitHubClientDeps = {}): GitHubClient {
  const doFetch: typeof fetch = (...args) => (deps.fetch ?? globalThis.fetch)(...args)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = deps.timeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS
  const now = deps.now ?? Date.now

  async function request(path: string, token: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchWithTimeout(
        doFetch,
        `${GITHUB_API_BASE_URL}${path}`,
        token,
        timeoutMs
      )
      if (response.ok) return response

      const body = await response.text().catch(() => '')
      const rateLimitWait = rateLimitWaitMs(response, body, now())
      if (rateLimitWait !== null) {
        if (attempt === 0 && rateLimitWait.ms <= GITHUB_MAX_RETRY_WAIT_MS) {
          await sleep(rateLimitWait.ms)
          continue
        }
        throw rateLimited(rateLimitWait)
      }
      throw errorForResponse(response, body, path)
    }
  }

  async function json(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw unexpected(response.status)
    }
  }

  return {
    async getUser(token: string): Promise<GitHubUser> {
      const response = await request('/user', token)
      const user = parseUser(await json(response), response.headers.get('x-oauth-scopes'))
      if (!user) throw unexpected(response.status)
      return user
    },

    async getRepository(token: string, owner: string, name: string): Promise<GitHubRepo> {
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
      const response = await request(path, token)
      const repo = parseRepository(await json(response))
      if (!repo) throw unexpected(response.status)
      return repo
    }
  }
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': GITHUB_USER_AGENT
  }
}

async function fetchWithTimeout(
  doFetch: typeof fetch,
  url: string,
  token: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await doFetch(url, {
      method: 'GET',
      headers: githubHeaders(token),
      signal: controller.signal
    })
  } catch {
    // Não propagamos a exceção original: ela pode carregar detalhes da requisição.
    throw controller.signal.aborted
      ? new GitHubApiError(
          'timeout',
          'O GitHub demorou demais para responder. Verifique sua conexão e tente novamente.'
        )
      : new GitHubApiError(
          'network',
          'Não foi possível falar com o GitHub. Verifique sua conexão com a internet.'
        )
  } finally {
    clearTimeout(timer)
  }
}

interface RateLimitWait {
  kind: 'primary' | 'secondary'
  ms: number
}

/**
 * Rate limits do GitHub (docs "Rate limits for the REST API"):
 * - secundário: 403/429 com Retry-After (ou mensagem de "secondary rate limit" sem header → 1 min);
 * - primário: 403/429 com x-ratelimit-remaining: 0 → esperar até x-ratelimit-reset (epoch s).
 * Devolve null quando a resposta não é de rate limit (ex.: 403 de permissão).
 */
export function rateLimitWaitMs(
  response: Response,
  body: string,
  now: number
): RateLimitWait | null {
  if (response.status !== 403 && response.status !== 429) return null

  const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'), now)
  if (retryAfter !== null) return { kind: 'secondary', ms: retryAfter }

  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset'))
    const ms = Number.isFinite(reset) && reset > 0 ? Math.max(0, reset * 1000 - now) : 60_000
    return { kind: 'primary', ms }
  }

  if (response.status === 429 || /secondary rate limit/i.test(body)) {
    return { kind: 'secondary', ms: GITHUB_SECONDARY_RATE_LIMIT_DEFAULT_MS }
  }
  return null
}

function rateLimited(wait: RateLimitWait): GitHubApiError {
  const when = formatWait(wait.ms)
  return new GitHubApiError(
    'rate_limited',
    wait.kind === 'primary'
      ? `Limite de requisições do GitHub atingido. Tente novamente ${when}.`
      : `O GitHub pediu para diminuir o ritmo. Tente novamente ${when}.`,
    429
  )
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 120) return `em ${seconds} s`
  return `em ${Math.ceil(seconds / 60)} min`
}

/**
 * Erros específicos de repositório/organização antes do mapeamento genérico:
 * - 403 + X-GitHub-SSO → SSO/SAML (com a URL de autorização, validada);
 * - 403 + mensagem de "OAuth App access restrictions" → um owner da org precisa aprovar;
 * - 404 em /repos → sem acesso ou inexistente.
 */
function errorForResponse(response: Response, body: string, path: string): GitHubApiError {
  const { status } = response
  const org = /^\/repos\/([^/]+)\//.exec(path)?.[1]
  const orgName = org ? decodeURIComponent(org) : undefined
  if (status === 403) {
    const sso = response.headers.get('x-github-sso')
    if (sso && /required/i.test(sso)) {
      const ssoUrl = parseSsoUrl(sso)
      return new GitHubApiError(
        'sso_required',
        `A organização${orgName ? ` ${orgName}` : ''} usa SSO (SAML). Autorize o acesso do Orkio pelo login da organização e tente de novo.`,
        status,
        { ...(ssoUrl ? { ssoUrl } : {}), ...(orgName ? { org: orgName } : {}) }
      )
    }
    if (/OAuth App access restrictions/i.test(body)) {
      return new GitHubApiError(
        'oauth_restricted',
        `A organização${orgName ? ` ${orgName}` : ''} restringe o acesso de OAuth Apps. Um admin da organização precisa aprovar o Orkio; você pode pedir a aprovação nas configurações de acesso da sua conta.`,
        status,
        orgName ? { org: orgName } : {}
      )
    }
  }
  if (status === 404 && path.startsWith('/repos/')) {
    return new GitHubApiError(
      'not_found',
      'O GitHub não encontrou este repositório com a conta conectada: ele não existe ou a conta não tem acesso.',
      status
    )
  }
  return errorForStatus(status)
}

/** "required; url=https://github.com/orgs/acme/sso?authorization_request=..." → URL validada. */
export function parseSsoUrl(header: string): string | null {
  const match = /url=([^;\s]+)/i.exec(header)
  if (!match) return null
  try {
    const url = new URL(match[1]!)
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      /^\/orgs\/[A-Za-z0-9-]+\/sso$/.test(url.pathname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function errorForStatus(status: number): GitHubApiError {
  if (status === 401) {
    return new GitHubApiError(
      'unauthorized',
      'Token do GitHub inválido, expirado ou revogado. Gere um novo token e cole aqui.',
      status
    )
  }
  if (status === 403) {
    return new GitHubApiError(
      'forbidden',
      'O GitHub recusou o acesso com este token. Verifique as permissões e se a sua organização exige aprovação (SSO).',
      status
    )
  }
  if (status >= 500) {
    return new GitHubApiError(
      'server',
      `O GitHub está instável agora (erro ${status}). Tente novamente em instantes.`,
      status
    )
  }
  return unexpected(status)
}

function unexpected(status: number): GitHubApiError {
  return new GitHubApiError(
    'unexpected',
    `Resposta inesperada do GitHub (HTTP ${status}). Tente novamente.`,
    status
  )
}

export function parseUser(body: unknown, scopesHeader: string | null): GitHubUser | null {
  if (!isRecord(body)) return null
  const login = stringOrNull(body['login'])
  const id = body['id']
  if (!login || typeof id !== 'number') return null
  return {
    id,
    login,
    name: stringOrNull(body['name']),
    avatarUrl: httpsUrlOrNull(body['avatar_url']),
    scopes:
      scopesHeader === null
        ? null
        : scopesHeader
            .split(',')
            .map((scope) => scope.trim())
            .filter(Boolean)
  }
}

export function parseRepository(body: unknown): GitHubRepo | null {
  if (!isRecord(body)) return null
  const name = stringOrNull(body['name'])
  const owner = isRecord(body['owner']) ? stringOrNull(body['owner']['login']) : null
  const defaultBranch = stringOrNull(body['default_branch'])
  if (!name || !owner || !defaultBranch) return null
  const visibility =
    body['visibility'] === 'public' ||
    body['visibility'] === 'private' ||
    body['visibility'] === 'internal'
      ? body['visibility']
      : body['private'] === true
        ? 'private'
        : 'public'
  const permissions = isRecord(body['permissions']) ? body['permissions'] : {}
  return {
    owner,
    name,
    defaultBranch,
    visibility,
    archived: body['archived'] === true,
    canPush: permissions['push'] === true || permissions['admin'] === true
  }
}

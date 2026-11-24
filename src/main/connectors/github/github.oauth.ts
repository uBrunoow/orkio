/**
 * Login com GitHub via OAuth Device Flow (OAuth App com "Enable Device Flow").
 *
 * Não precisa de client secret nem de redirect: o app pede um código, o usuário o digita em
 * github.com/login/device e o app consulta o endpoint de token até a autorização. Por isso o
 * GitHub NÃO usa o intermediário do Notion (rotas /notion/* do site).
 */
import { ApiError, genericStatusError, requestJson, unexpectedError } from '../../net/http'
import { isRecord, stringOrNull } from '../../net/parse'
import type { DeviceAuthorization, DevicePollResult } from '../../oauth/device-flow'
import { GITHUB_USER_AGENT } from './github.client'

const GITHUB = { service: 'github' } as const

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
export const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const GITHUB_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
/**
 * `repo`: único escopo de OAuth App que dá acesso a repositórios privados, PRs e comentários
 * e permite abrir PRs depois. Não existe variante só-leitura (`public_repo` não cobre privados).
 */
export const GITHUB_OAUTH_SCOPES = ['repo'] as const
export const GITHUB_OAUTH_TIMEOUT_MS = 10_000

export interface GitHubOAuthConfig {
  clientId: string
}

export interface GitHubOAuthEnv {
  MAIN_VITE_GITHUB_CLIENT_ID?: string | undefined
}

/** Lê o client ID do build (não é segredo). null → login com GitHub indisponível. */
export function readGitHubOAuthConfig(env: GitHubOAuthEnv): GitHubOAuthConfig | null {
  const clientId = (env.MAIN_VITE_GITHUB_CLIENT_ID ?? '').trim()
  if (!clientId || !/^[A-Za-z0-9._-]{4,100}$/.test(clientId)) return null
  return { clientId }
}

export interface GitHubOAuthToken {
  accessToken: string
  scopes: string[]
}

export interface GitHubDeviceApi {
  requestCode(): Promise<DeviceAuthorization>
  pollToken(deviceCode: string): Promise<DevicePollResult<GitHubOAuthToken>>
}

export interface GitHubDeviceApiDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

const CONFIG_ERROR = new ApiError(
  'github',
  'oauth_config',
  'O login com GitHub está mal configurado nesta versão do Orkio (OAuth App sem Device Flow ou client ID inválido). Use um token ou avise quem mantém o app.'
)

export function createGitHubDeviceApi(
  config: GitHubOAuthConfig,
  deps: GitHubDeviceApiDeps = {}
): GitHubDeviceApi {
  const timeoutMs = deps.timeoutMs ?? GITHUB_OAUTH_TIMEOUT_MS

  async function post(url: string, payload: Record<string, string>): Promise<unknown> {
    const response = await requestJson(
      {
        url,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': GITHUB_USER_AGENT
        },
        body: JSON.stringify(payload)
      },
      { ...GITHUB, fetch: deps.fetch, timeoutMs }
    )
    if (response.status >= 500) throw genericStatusError(GITHUB, response.status)
    const body = response.body
    // Erros do Device Flow vêm com HTTP 200 e campo `error`; client ID inválido costuma ser 4xx.
    if (!response.ok && !(isRecord(body) && typeof body['error'] === 'string')) throw CONFIG_ERROR
    return body
  }

  return {
    async requestCode(): Promise<DeviceAuthorization> {
      const body = await post(GITHUB_DEVICE_CODE_URL, {
        client_id: config.clientId,
        scope: GITHUB_OAUTH_SCOPES.join(' ')
      })
      if (isRecord(body) && typeof body['error'] === 'string') throw errorForCode(body['error'])
      const parsed = parseDeviceCodeResponse(body)
      if (!parsed) throw unexpectedError(GITHUB, 200)
      return parsed
    },

    async pollToken(deviceCode: string): Promise<DevicePollResult<GitHubOAuthToken>> {
      const body = await post(GITHUB_ACCESS_TOKEN_URL, {
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: GITHUB_DEVICE_GRANT_TYPE
      })
      return parseTokenPollResponse(body)
    }
  }
}

export function parseDeviceCodeResponse(body: unknown): DeviceAuthorization | null {
  if (!isRecord(body)) return null
  const deviceCode = stringOrNull(body['device_code'])
  const userCode = stringOrNull(body['user_code'])
  const verificationUri = stringOrNull(body['verification_uri'])
  const expiresIn = body['expires_in']
  const interval = body['interval']
  if (!deviceCode || !userCode || !verificationUri || !isGitHubDevicePage(verificationUri)) {
    return null
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresInSec: typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 900,
    intervalSec: typeof interval === 'number' && interval > 0 ? interval : 5
  }
}

/** Só aceitamos a página oficial; a UI vai abrir essa URL no navegador. */
export function isGitHubDevicePage(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith('/login/device') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function parseTokenPollResponse(body: unknown): DevicePollResult<GitHubOAuthToken> {
  if (!isRecord(body)) throw unexpectedError(GITHUB, 200)
  const accessToken = stringOrNull(body['access_token'])
  if (accessToken) {
    const scope = typeof body['scope'] === 'string' ? body['scope'] : ''
    return {
      kind: 'token',
      value: {
        accessToken,
        scopes: scope
          .split(/[ ,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }
  }

  const error = typeof body['error'] === 'string' ? body['error'] : ''
  switch (error) {
    case 'authorization_pending':
      return { kind: 'pending' }
    case 'slow_down': {
      const interval = body['interval']
      return typeof interval === 'number' && interval > 0
        ? { kind: 'slow_down', intervalSec: interval }
        : { kind: 'slow_down' }
    }
    // A documentação usa os dois nomes; códigos inválidos também exigem recomeçar.
    case 'expired_token':
    case 'token_expired':
    case 'incorrect_device_code':
    case 'bad_verification_code':
      return { kind: 'expired' }
    case 'access_denied':
      return { kind: 'denied' }
    default:
      throw errorForCode(error)
  }
}

function errorForCode(error: string): ApiError {
  if (
    error === 'device_flow_disabled' ||
    error === 'incorrect_client_credentials' ||
    error === 'unsupported_grant_type' ||
    error === 'unauthorized_client' ||
    error === 'invalid_client'
  ) {
    return CONFIG_ERROR
  }
  if (error === 'slow_down' || error === 'rate_limited') {
    return new ApiError(
      'github',
      'rate_limited',
      'Muitas tentativas de login seguidas. Aguarde alguns minutos e tente de novo.'
    )
  }
  // Recusa sem motivo conhecido: não é transitória (o polling para e mostra a mensagem).
  return new ApiError('github', 'invalid', 'O GitHub recusou o login. Tente novamente.')
}

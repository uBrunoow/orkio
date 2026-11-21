/**
 * OAuth do Notion (conexão pública / "OAuth connection").
 *
 * O Notion exige client_secret na troca do código (HTTP Basic em /v1/oauth/token) e não
 * aceita PKCE na API REST. Como um app desktop não guarda segredos, a troca e a renovação
 * passam por um intermediário mínimo (broker/, Cloudflare Worker) que guarda o secret e
 * não armazena tokens. Aqui ficam: config, URL de autorização, client do intermediário e
 * a leitura da resposta de token.
 */
import { httpsUrlOrNull, isRecord, stringOrNull } from '../../net/parse'
import { NOTION_API_BASE_URL, NotionApiError } from './notion.client'

export const NOTION_OAUTH_AUTHORIZE_URL = `${NOTION_API_BASE_URL}/oauth/authorize`
/** Precisa estar cadastrada em "Redirect URIs" da conexão OAuth no Notion e no intermediário. */
// `localhost` e não `127.0.0.1`: o Notion recusa IP em redirect URI. O servidor local escuta só em
// 127.0.0.1 (loopback.ts) e confere o header Host.
export const NOTION_OAUTH_REDIRECT_URI = 'http://localhost:47821/oauth/notion/callback'
/** Tempo máximo para o usuário autorizar no navegador. */
export const NOTION_OAUTH_TIMEOUT_MS = 5 * 60_000
export const NOTION_BROKER_TIMEOUT_MS = 15_000

export interface NotionOAuthConfig {
  clientId: string
  /** URL base do intermediário, sem barra no final. */
  brokerUrl: string
}

/**
 * Lê a config de build (variáveis MAIN_VITE_*). Devolve null se faltar algo ou se a URL do
 * intermediário não for https (http só é aceito em loopback, para desenvolvimento).
 */
export interface NotionOAuthEnv {
  MAIN_VITE_NOTION_OAUTH_CLIENT_ID?: string | undefined
  MAIN_VITE_NOTION_OAUTH_BROKER_URL?: string | undefined
}

export function readNotionOAuthConfig(env: NotionOAuthEnv): NotionOAuthConfig | null {
  const clientId = (env.MAIN_VITE_NOTION_OAUTH_CLIENT_ID ?? '').trim()
  const brokerRaw = (env.MAIN_VITE_NOTION_OAUTH_BROKER_URL ?? '').trim()
  if (!clientId || !brokerRaw || /\s/.test(clientId)) return null
  let broker: URL
  try {
    broker = new URL(brokerRaw)
  } catch {
    return null
  }
  const loopback = broker.hostname === '127.0.0.1' || broker.hostname === 'localhost'
  if (broker.protocol !== 'https:' && !(broker.protocol === 'http:' && loopback)) return null
  if (broker.search || broker.hash || broker.username || broker.password) return null
  return { clientId, brokerUrl: broker.href.replace(/\/+$/, '') }
}

export function buildNotionAuthorizeUrl(
  clientId: string,
  state: string,
  redirectUri: string = NOTION_OAUTH_REDIRECT_URI
): string {
  const url = new URL(NOTION_OAUTH_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  // Token no nível do usuário (o modelo atual do Notion).
  url.searchParams.set('owner', 'user')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

/** Tokens e metadados devolvidos pelo Notion (via intermediário). Nunca sai do main. */
export interface NotionTokenSet {
  accessToken: string
  /** Pode faltar em conexões antigas; sem ele, um 401 exige reconectar. */
  refreshToken: string | null
  botId: string
  workspaceId: string | null
  workspaceName: string | null
  /** Só quando o ícone do workspace é uma URL https (pode ser emoji). */
  workspaceIconUrl: string | null
  ownerName: string | null
  ownerAvatarUrl: string | null
}

export function parseNotionTokenResponse(body: unknown): NotionTokenSet | null {
  if (!isRecord(body)) return null
  const accessToken = stringOrNull(body['access_token'])
  const botId = stringOrNull(body['bot_id'])
  if (!accessToken || !botId) return null

  let ownerName: string | null = null
  let ownerAvatarUrl: string | null = null
  const owner = body['owner']
  if (isRecord(owner) && owner['type'] === 'user' && isRecord(owner['user'])) {
    ownerName = stringOrNull(owner['user']['name'])
    ownerAvatarUrl = httpsUrlOrNull(owner['user']['avatar_url'])
  }

  return {
    accessToken,
    refreshToken: stringOrNull(body['refresh_token']),
    botId,
    workspaceId: stringOrNull(body['workspace_id']),
    workspaceName: stringOrNull(body['workspace_name']),
    workspaceIconUrl: httpsUrlOrNull(body['workspace_icon']),
    ownerName,
    ownerAvatarUrl
  }
}

export interface NotionOAuthBroker {
  exchangeCode(code: string, redirectUri: string): Promise<NotionTokenSet>
  refresh(refreshToken: string): Promise<NotionTokenSet>
}

export interface NotionOAuthBrokerDeps {
  fetch?: typeof fetch
  timeoutMs?: number
}

export function createNotionOAuthBroker(
  config: NotionOAuthConfig,
  deps: NotionOAuthBrokerDeps = {}
): NotionOAuthBroker {
  const doFetch: typeof fetch = (...args) => (deps.fetch ?? globalThis.fetch)(...args)
  const timeoutMs = deps.timeoutMs ?? NOTION_BROKER_TIMEOUT_MS

  async function post(path: string, payload: Record<string, string>): Promise<NotionTokenSet> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await doFetch(`${config.brokerUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
    } catch {
      throw controller.signal.aborted
        ? new NotionApiError(
            'timeout',
            'O serviço de login do Orkio demorou demais para responder. Tente novamente.'
          )
        : new NotionApiError(
            'network',
            'Não foi possível falar com o serviço de login do Orkio. Verifique sua internet.'
          )
    } finally {
      clearTimeout(timer)
    }

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // corpo vazio ou não-JSON: tratado abaixo pelo status
    }

    if (response.ok) {
      const tokens = parseNotionTokenResponse(body)
      if (!tokens) throw brokerUnexpected(response.status)
      return tokens
    }
    throw brokerError(response.status, isRecord(body) ? stringOrNull(body['error']) : null)
  }

  return {
    exchangeCode: (code, redirectUri) => post('/notion/token', { code, redirect_uri: redirectUri }),
    refresh: (refreshToken) => post('/notion/refresh', { refresh_token: refreshToken })
  }
}

function brokerError(status: number, error: string | null): NotionApiError {
  if (error === 'invalid_grant') {
    return new NotionApiError(
      'invalid_grant',
      'Sua autorização do Notion expirou ou foi revogada. Conecte o Notion de novo.',
      status
    )
  }
  if (error === 'invalid_client' || error === 'unauthorized_client' || status === 401) {
    return new NotionApiError(
      'oauth_config',
      'O login com Notion está mal configurado nesta versão do Orkio. Avise quem mantém o app.',
      status
    )
  }
  if (status === 429) {
    return new NotionApiError(
      'rate_limited',
      'Muitas tentativas de login seguidas. Aguarde um pouco e tente de novo.',
      status
    )
  }
  if (status >= 500) {
    return new NotionApiError(
      'server',
      `O serviço de login está instável agora (erro ${status}). Tente novamente em instantes.`,
      status
    )
  }
  return brokerUnexpected(status)
}

function brokerUnexpected(status: number): NotionApiError {
  return new NotionApiError(
    'unexpected',
    `Resposta inesperada do serviço de login (HTTP ${status}). Tente novamente.`,
    status
  )
}

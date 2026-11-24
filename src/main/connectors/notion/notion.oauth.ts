/**
 * OAuth do Notion (conexão pública / "OAuth connection").
 *
 * O Notion exige client_secret na troca do código (HTTP Basic em /v1/oauth/token) e não
 * aceita PKCE na API REST. Como um app desktop não guarda segredos, a troca e a renovação
 * passam por um intermediário mínimo (rotas /notion/* do site, na Vercel) que guarda o secret
 * e não armazena tokens. Aqui ficam: config, URL de autorização, client do intermediário e
 * a leitura da resposta de token.
 */
import {
  ApiError,
  genericStatusError,
  requestJson,
  unexpectedError,
  type ApiTarget
} from '../../net/http'
import { httpsUrlOrNull, isRecord, stringOrNull } from '../../net/parse'
import { NOTION_OAUTH_REDIRECT_URI } from '../../../shared/site-contract'
import { NOTION_API_BASE_URL } from './notion.client'

/** Cadastrada em "Redirect URIs" da conexão OAuth no Notion e no intermediário (site). */
export { NOTION_OAUTH_REDIRECT_URI }

export const NOTION_OAUTH_AUTHORIZE_URL = `${NOTION_API_BASE_URL}/oauth/authorize`
/** Tempo máximo para o usuário autorizar no navegador. */
export const NOTION_OAUTH_TIMEOUT_MS = 5 * 60_000
export const NOTION_BROKER_TIMEOUT_MS = 15_000

export interface NotionOAuthConfig {
  clientId: string
  /** Origem do site do Orkio (`siteOrigin()`); o intermediário fica em `<site>/notion/*`. */
  siteOrigin: string
}

/**
 * Config do login com Notion: client ID (público) e a origem do site, já conferida por
 * `siteOrigin()`. `null` se faltar algo ou se o site apontar para o próprio servidor de retorno
 * do app (a porta do redirect URI): esse servidor só existe durante o login e não troca códigos,
 * então a troca falharia sempre como "sem internet".
 */
export function readNotionOAuthConfig(
  clientIdRaw: string | undefined,
  siteOrigin: string | null
): NotionOAuthConfig | null {
  const clientId = (clientIdRaw ?? '').trim()
  if (!clientId || /\s/.test(clientId) || !siteOrigin) return null
  const site = new URL(siteOrigin)
  if (isLoopbackHost(site.hostname) && site.port === new URL(NOTION_OAUTH_REDIRECT_URI).port) {
    return null
  }
  return { clientId, siteOrigin }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
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

/** Erros do intermediário são do login do Notion (o conector os trata como do Notion). */
const BROKER: ApiTarget = { service: 'notion', label: 'o serviço de login do Orkio' }

export function createNotionOAuthBroker(
  config: NotionOAuthConfig,
  deps: NotionOAuthBrokerDeps = {}
): NotionOAuthBroker {
  const timeoutMs = deps.timeoutMs ?? NOTION_BROKER_TIMEOUT_MS
  const brokerOrigin = new URL(config.siteOrigin)
  // Só a origem (sem caminho) entra nas mensagens: é config de build, não é segredo.
  const unreachable = isLoopbackHost(brokerOrigin.hostname)
    ? `Não foi possível falar com o intermediário de login local (${brokerOrigin.origin}). Em ` +
      'desenvolvimento, rode o site (pnpm --dir site dev) ou aponte ' +
      'MAIN_VITE_SITE_URL para o site publicado.'
    : `Não foi possível falar com o serviço de login do Orkio (${brokerOrigin.host}). Verifique ` +
      'sua internet e tente de novo.'

  async function post(path: string, payload: Record<string, string>): Promise<NotionTokenSet> {
    const response = await requestJson(
      {
        url: `${config.siteOrigin}${path}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      },
      { ...BROKER, fetch: deps.fetch, timeoutMs, messages: { network: unreachable } }
    )
    if (response.ok) {
      const tokens = parseNotionTokenResponse(response.body)
      if (!tokens) throw unexpectedError(BROKER, response.status)
      return tokens
    }
    throw brokerError(
      response.status,
      isRecord(response.body) ? stringOrNull(response.body['error']) : null
    )
  }

  return {
    exchangeCode: (code, redirectUri) => post('/notion/token', { code, redirect_uri: redirectUri }),
    refresh: (refreshToken) => post('/notion/refresh', { refresh_token: refreshToken })
  }
}

function brokerError(status: number, error: string | null): ApiError {
  if (error === 'invalid_grant') {
    return new ApiError(
      'notion',
      'invalid_grant',
      'Sua autorização do Notion expirou ou foi revogada. Conecte o Notion de novo.',
      status
    )
  }
  if (error === 'redirect_uri_not_allowed') {
    return new ApiError(
      'notion',
      'oauth_config',
      'O serviço de login do Orkio recusou o endereço de retorno deste app (configuração do ' +
        'intermediário). Avise quem mantém o Orkio. Enquanto isso, use um token.',
      status
    )
  }
  if (error === 'invalid_client' || error === 'unauthorized_client' || status === 401) {
    return new ApiError(
      'notion',
      'oauth_config',
      'O login com Notion está mal configurado nesta versão do Orkio. Avise quem mantém o app.',
      status
    )
  }
  if (status === 429) {
    return new ApiError(
      'notion',
      'rate_limited',
      'Muitas tentativas de login seguidas. Aguarde um pouco e tente de novo.',
      status
    )
  }
  return genericStatusError(BROKER, status)
}

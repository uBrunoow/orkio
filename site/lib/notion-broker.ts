/**
 * Orkio — intermediário OAuth do Notion (rotas `/notion/*` do site na Vercel), com o contrato que
 * o app usa em `notion.oauth.ts`.
 *
 * Por que existe: o Notion exige client_secret para trocar o código e renovar tokens
 * (HTTP Basic em /v1/oauth/token) e não aceita PKCE na API REST. Um app desktop não guarda
 * segredos, então só este servidor conhece o secret.
 *
 * Regras:
 * - Sem estado: não guarda tokens, códigos nem logs de requisição. Nada de console.* (ESLint).
 * - Só aceita os redirect URIs configurados em ALLOWED_REDIRECT_URIS.
 * - Devolve ao app apenas os campos conhecidos da resposta do Notion.
 *
 * Rotas (`app/notion/*`):
 *   POST /notion/token    { code, redirect_uri }  → resposta de token do Notion
 *   POST /notion/refresh  { refresh_token }       → resposta de token do Notion
 */
import { NOTION_VERSION } from './contract'
import { isRecord, json, loopbackOverride, readJsonBody } from './http'

export interface BrokerEnv {
  /** OAuth client ID da conexão do Notion (não é segredo). */
  NOTION_CLIENT_ID: string | undefined
  /** OAuth client secret: só em variável de ambiente da Vercel. */
  NOTION_CLIENT_SECRET: string | undefined
  /** Redirect URIs aceitos, separados por vírgula. */
  ALLOWED_REDIRECT_URIS: string | undefined
  /**
   * Só para o E2E local (critério da 6A): endpoint de token alternativo. Ignorado na Vercel e
   * aceito apenas em http://127.0.0.1 (`tokenUrlFrom`).
   */
  NOTION_TOKEN_URL?: string | undefined
  VERCEL?: string | undefined
}

export const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
export const MAX_BODY_BYTES = 8 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000

/** Campos da resposta de token repassados ao app. */
const TOKEN_FIELDS = [
  'access_token',
  'token_type',
  'refresh_token',
  'expires_in',
  'bot_id',
  'workspace_id',
  'workspace_name',
  'workspace_icon',
  'owner',
  'duplicated_template_id'
] as const

export type BrokerRoute = 'token' | 'refresh'

const BODY_PROBLEM = {
  content_type: 'Use application/json.',
  too_large: 'Corpo grande demais.',
  json: 'JSON inválido.'
} as const

/** Variáveis do processo (route handlers). */
export function brokerEnv(): BrokerEnv {
  return {
    NOTION_CLIENT_ID: process.env['NOTION_CLIENT_ID'],
    NOTION_CLIENT_SECRET: process.env['NOTION_CLIENT_SECRET'],
    ALLOWED_REDIRECT_URIS: process.env['ALLOWED_REDIRECT_URIS'],
    NOTION_TOKEN_URL: process.env['NOTION_TOKEN_URL'],
    VERCEL: process.env['VERCEL']
  }
}

/** Endpoint de token: o do Notion; fora da Vercel, um loopback explícito (E2E). */
export function tokenUrlFrom(env: BrokerEnv): string {
  return loopbackOverride(env, env.NOTION_TOKEN_URL, NOTION_TOKEN_URL)
}

export async function handleBroker(
  route: BrokerRoute,
  request: Request,
  env: BrokerEnv,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
    return json(500, { error: 'server_misconfigured' })
  }
  const read = await readJsonBody(request, MAX_BODY_BYTES)
  if (!read.ok) {
    return json(read.status, {
      error: 'invalid_request',
      error_description: BODY_PROBLEM[read.problem]
    })
  }
  const body = read.value
  if (!isRecord(body)) return json(400, { error: 'invalid_request' })

  let grant: Record<string, string>
  if (route === 'token') {
    const code = boundedString(body['code'], 2048)
    const redirectUri = boundedString(body['redirect_uri'], 512)
    if (!code || !redirectUri) return json(400, { error: 'invalid_request' })
    if (!allowedRedirects(env).has(redirectUri)) {
      // Código próprio (não `invalid_request`): o app mostra que a lista de redirect URIs do
      // intermediário (ALLOWED_REDIRECT_URIS) não tem o endereço de retorno desta versão.
      return json(400, {
        error: 'redirect_uri_not_allowed',
        error_description: 'redirect_uri não permitido.'
      })
    }
    grant = { grant_type: 'authorization_code', code, redirect_uri: redirectUri }
  } else {
    const refreshToken = boundedString(body['refresh_token'], 4096)
    if (!refreshToken) return json(400, { error: 'invalid_request' })
    grant = { grant_type: 'refresh_token', refresh_token: refreshToken }
  }

  return exchangeWithNotion(grant, env, fetchImpl)
}

async function exchangeWithNotion(
  grant: Record<string, string>,
  env: BrokerEnv,
  fetchImpl: typeof fetch
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    const basic = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString(
      'base64'
    )
    upstream = await fetchImpl(tokenUrlFrom(env), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Notion-Version': NOTION_VERSION
      },
      body: JSON.stringify(grant),
      signal: controller.signal,
      cache: 'no-store'
    })
  } catch {
    return json(502, { error: 'upstream_unavailable' })
  } finally {
    clearTimeout(timer)
  }

  let payload: unknown = null
  try {
    payload = await upstream.json()
  } catch {
    // corpo vazio/não-JSON
  }

  if (upstream.ok) {
    if (!isRecord(payload) || typeof payload['access_token'] !== 'string') {
      return json(502, { error: 'upstream_invalid_response' })
    }
    const result: Record<string, unknown> = {}
    for (const field of TOKEN_FIELDS) {
      if (field in payload) result[field] = payload[field]
    }
    return json(200, result)
  }

  // Erro do Notion: formato OAuth ({ error }) ou da API ({ object: 'error', code }).
  const code = isRecord(payload)
    ? (boundedString(payload['error'], 64) ?? boundedString(payload['code'], 64))
    : null
  const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502
  const error = code ?? (status === 401 ? 'invalid_client' : 'upstream_error')
  const headers: Record<string, string> = {}
  const retryAfter = upstream.headers.get('retry-after')
  if (status === 429 && retryAfter && /^\d{1,5}$/.test(retryAfter.trim())) {
    headers['Retry-After'] = retryAfter.trim()
  }
  return json(status, { error }, headers)
}

function allowedRedirects(env: BrokerEnv): Set<string> {
  return new Set(
    (env.ALLOWED_REDIRECT_URIS ?? '')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean)
  )
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

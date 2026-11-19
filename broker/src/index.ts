/**
 * Orkio — intermediário OAuth do Notion (Cloudflare Worker).
 *
 * Por que existe: o Notion exige client_secret para trocar o código e renovar tokens
 * (HTTP Basic em /v1/oauth/token) e não aceita PKCE na API REST. Um app desktop não guarda
 * segredos, então só este Worker conhece o secret.
 *
 * Regras:
 * - Sem estado: não guarda tokens, códigos nem logs de requisição. Nada de console.log.
 * - Só aceita os redirect URIs configurados em ALLOWED_REDIRECT_URIS.
 * - Devolve ao app apenas os campos conhecidos da resposta do Notion.
 *
 * Rotas:
 *   POST /notion/token    { code, redirect_uri }  → resposta de token do Notion
 *   POST /notion/refresh  { refresh_token }       → resposta de token do Notion
 *   GET  /health                                   → { ok: true }
 */

export interface Env {
  /** OAuth client ID da conexão do Notion (público, em [vars]). */
  NOTION_CLIENT_ID: string
  /** OAuth client secret — SÓ via `wrangler secret put NOTION_CLIENT_SECRET`. */
  NOTION_CLIENT_SECRET: string
  /** Redirect URIs aceitos, separados por vírgula. */
  ALLOWED_REDIRECT_URIS: string
}

export const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
export const NOTION_VERSION = '2026-03-11'
const MAX_BODY_BYTES = 8 * 1024
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

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  }
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (pathname === '/health') {
    return request.method === 'GET' ? json(200, { ok: true }) : methodNotAllowed('GET')
  }
  if (pathname !== '/notion/token' && pathname !== '/notion/refresh') {
    return json(404, { error: 'not_found' })
  }
  if (request.method !== 'POST') return methodNotAllowed('POST')
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
    return json(500, { error: 'server_misconfigured' })
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return json(415, { error: 'invalid_request', error_description: 'Use application/json.' })
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return json(413, { error: 'invalid_request', error_description: 'Corpo grande demais.' })
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid_request', error_description: 'JSON inválido.' })
  }
  if (!isRecord(body)) return json(400, { error: 'invalid_request' })

  let grant: Record<string, string>
  if (pathname === '/notion/token') {
    const code = boundedString(body['code'], 2048)
    const redirectUri = boundedString(body['redirect_uri'], 512)
    if (!code || !redirectUri) return json(400, { error: 'invalid_request' })
    if (!allowedRedirects(env).has(redirectUri)) {
      return json(400, {
        error: 'invalid_request',
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
  env: Env,
  fetchImpl: typeof fetch
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetchImpl(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Notion-Version': NOTION_VERSION
      },
      body: JSON.stringify(grant),
      signal: controller.signal
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
  if (status === 429 && retryAfter) headers['Retry-After'] = retryAfter
  return json(status, { error }, headers)
}

function allowedRedirects(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_REDIRECT_URIS ?? '')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean)
  )
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  })
}

function methodNotAllowed(allow: string): Response {
  return json(405, { error: 'method_not_allowed' }, { Allow: allow })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

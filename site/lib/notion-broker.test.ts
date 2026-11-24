/**
 * Intermediário OAuth do Notion. `handleRequest` faz o papel do roteador do Next (app/notion/*,
 * app/health): chama os mesmos handlers que as rotas usam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as healthGet } from '@/app/health/route'
import { GET as tokenGet } from '@/app/notion/token/route'
import { GET as refreshGet } from '@/app/notion/refresh/route'
import { NOTION_OAUTH_REDIRECT_URI, NOTION_VERSION } from './contract'
import { NOTION_TOKEN_URL, handleBroker, type BrokerEnv } from './notion-broker'

type Env = BrokerEnv

async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/health') return healthGet()
  if (pathname !== '/notion/token' && pathname !== '/notion/refresh') {
    throw new Error(`rota fora do intermediário: ${pathname}`)
  }
  if (request.method !== 'POST') return pathname === '/notion/token' ? tokenGet() : refreshGet()
  return handleBroker(pathname === '/notion/token' ? 'token' : 'refresh', request, env, fetchImpl)
}

// Nada é logado em nenhum caminho do intermediário (corpo, tokens, headers): o teste confere o
// comportamento em todos os casos deste arquivo (a regra de lint `no-console` cobre o texto).
let logs: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined)
  )
})
afterEach(() => {
  for (const spy of logs) expect(spy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

const SECRET = 'secret_CLIENT_SECRET_NEVER_IN_RESPONSES'
const REDIRECT = NOTION_OAUTH_REDIRECT_URI
const ENV: Env = {
  NOTION_CLIENT_ID: 'client-123',
  NOTION_CLIENT_SECRET: SECRET,
  ALLOWED_REDIRECT_URIS: `${REDIRECT}, http://127.0.0.1:47822/oauth/notion/callback`
}

const NOTION_OK = {
  access_token: 'ntn_access',
  token_type: 'bearer',
  refresh_token: 'nrt_refresh',
  bot_id: 'bot-1',
  workspace_id: 'ws-1',
  workspace_name: 'Acme',
  workspace_icon: null,
  owner: { type: 'user', user: { id: 'u1', name: 'Ada' } },
  duplicated_template_id: null,
  request_id: 'req-1',
  campo_desconhecido: 'não deve passar'
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://broker.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

function notion(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers }))
}

async function read(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const text = await res.text()
  expect(text).not.toContain(SECRET)
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown> }
}

describe('broker — POST /notion/token', () => {
  it('troca o code no Notion com HTTP Basic (client_id:secret) e repassa só campos conhecidos', async () => {
    const upstream = notion(NOTION_OK)
    const res = await handleRequest(
      post('/notion/token', { code: 'code-1', redirect_uri: REDIRECT }),
      ENV,
      upstream
    )

    const { status, body } = await read(res)
    expect(status).toBe(200)
    expect(body).toMatchObject({ access_token: 'ntn_access', refresh_token: 'nrt_refresh' })
    expect(body).not.toHaveProperty('campo_desconhecido')
    expect(body).not.toHaveProperty('request_id')
    expect(res.headers.get('cache-control')).toBe('no-store')

    const [url, init] = upstream.mock.calls[0]!
    expect(url).toBe(NOTION_TOKEN_URL)
    const headers = init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Basic ${btoa(`client-123:${SECRET}`)}`)
    expect(headers['Notion-Version']).toBe(NOTION_VERSION)
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: REDIRECT
    })
  })

  it('redirect_uri fora da lista → 400 sem chamar o Notion', async () => {
    const upstream = notion(NOTION_OK)
    const res = await handleRequest(
      post('/notion/token', { code: 'c', redirect_uri: 'https://evil.example/cb' }),
      ENV,
      upstream
    )
    // Código próprio: o app diz que falta o redirect URI em ALLOWED_REDIRECT_URIS.
    expect(await read(res)).toMatchObject({
      status: 400,
      body: { error: 'redirect_uri_not_allowed' }
    })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('code ausente ou corpo inválido → 400', async () => {
    const upstream = notion(NOTION_OK)
    for (const body of [
      { redirect_uri: REDIRECT },
      '{oops',
      '[]',
      { code: 1, redirect_uri: REDIRECT }
    ]) {
      expect((await handleRequest(post('/notion/token', body), ENV, upstream)).status).toBe(400)
    }
    expect(upstream).not.toHaveBeenCalled()
  })

  it('erros do Notion são repassados com o código OAuth', async () => {
    const invalidGrant = await handleRequest(
      post('/notion/token', { code: 'c', redirect_uri: REDIRECT }),
      ENV,
      notion({ error: 'invalid_grant', error_description: 'expired' }, 400)
    )
    expect(await read(invalidGrant)).toEqual({ status: 400, body: { error: 'invalid_grant' } })

    const badClient = await handleRequest(
      post('/notion/token', { code: 'c', redirect_uri: REDIRECT }),
      ENV,
      notion({ object: 'error', status: 401, code: 'unauthorized' }, 401)
    )
    expect(await read(badClient)).toEqual({ status: 401, body: { error: 'unauthorized' } })
  })

  it('429 do Notion mantém Retry-After', async () => {
    const res = await handleRequest(
      post('/notion/token', { code: 'c', redirect_uri: REDIRECT }),
      ENV,
      notion({ object: 'error', code: 'rate_limited' }, 429, { 'Retry-After': '7' })
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('7')
  })

  it('Notion fora do ar ou resposta estranha → 502', async () => {
    const offline = await handleRequest(
      post('/notion/token', { code: 'c', redirect_uri: REDIRECT }),
      ENV,
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('network')
      })
    )
    expect(await read(offline)).toEqual({ status: 502, body: { error: 'upstream_unavailable' } })

    const weird = await handleRequest(
      post('/notion/token', { code: 'c', redirect_uri: REDIRECT }),
      ENV,
      notion({ ok: true })
    )
    expect((await read(weird)).status).toBe(502)
  })
})

describe('broker — POST /notion/refresh', () => {
  it('renova com grant_type refresh_token', async () => {
    const upstream = notion(NOTION_OK)
    const res = await handleRequest(
      post('/notion/refresh', { refresh_token: 'nrt_old' }),
      ENV,
      upstream
    )
    expect((await read(res)).status).toBe(200)
    expect(JSON.parse(String(upstream.mock.calls[0]![1]?.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'nrt_old'
    })
  })

  it('sem refresh_token → 400', async () => {
    expect((await handleRequest(post('/notion/refresh', {}), ENV, notion(NOTION_OK))).status).toBe(
      400
    )
  })
})

describe('intermediário — proteção geral', () => {
  it('métodos e content-type', async () => {
    const upstream = notion(NOTION_OK)
    const get = await handleRequest(new Request('https://b.example/notion/token'), ENV, upstream)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    const text = await handleRequest(
      post('/notion/refresh', { refresh_token: 'x' }, { 'Content-Type': 'text/plain' }),
      ENV,
      upstream
    )
    expect(text.status).toBe(415)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('corpo grande demais → 413', async () => {
    const res = await handleRequest(
      post('/notion/refresh', { refresh_token: 'x'.repeat(10_000) }),
      ENV,
      notion(NOTION_OK)
    )
    expect(res.status).toBe(413)
  })

  it('sem secret configurado → 500 sem chamar o Notion', async () => {
    const upstream = notion(NOTION_OK)
    const res = await handleRequest(
      post('/notion/refresh', { refresh_token: 'x' }),
      { ...ENV, NOTION_CLIENT_SECRET: '' },
      upstream
    )
    expect(await read(res)).toEqual({ status: 500, body: { error: 'server_misconfigured' } })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('/health responde', async () => {
    const res = await handleRequest(new Request('https://b.example/health'), ENV)
    expect(await res.json()).toEqual({ ok: true })
  })
})

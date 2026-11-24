import { describe, expect, it, vi } from 'vitest'
import {
  NOTION_OAUTH_REDIRECT_URI,
  buildNotionAuthorizeUrl,
  createNotionOAuthBroker,
  parseNotionTokenResponse,
  readNotionOAuthConfig
} from './notion.oauth'

const ACCESS = 'ntn_ACCESS_TOKEN_SHOULD_NEVER_LEAK'
const REFRESH = 'nrt_REFRESH_TOKEN_SHOULD_NEVER_LEAK'
const CONFIG = { clientId: 'client-123', siteOrigin: 'https://broker.example' }

const TOKEN_RESPONSE = {
  access_token: ACCESS,
  token_type: 'bearer',
  refresh_token: REFRESH,
  bot_id: 'bot-1',
  workspace_id: 'ws-1',
  workspace_name: 'Acme',
  workspace_icon: 'https://s3.example.com/acme.png',
  owner: {
    type: 'user',
    user: { object: 'user', id: 'u1', name: 'Ada Lovelace', avatar_url: 'https://x/ada.png' }
  },
  duplicated_template_id: null,
  request_id: 'req-1'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function expectNoLeak(value: unknown): void {
  const text = `${String(value)} ${JSON.stringify(value)} ${(value as Error)?.stack ?? ''}`
  expect(text).not.toContain(ACCESS)
  expect(text).not.toContain(REFRESH)
}

describe('readNotionOAuthConfig', () => {
  it('client ID + origem do site (o intermediário fica em <site>/notion/*)', () => {
    expect(readNotionOAuthConfig(' client-123 ', 'https://orkio.dev')).toEqual({
      clientId: 'client-123',
      siteOrigin: 'https://orkio.dev'
    })
    expect(readNotionOAuthConfig('c', 'http://127.0.0.1:3000')).toEqual({
      clientId: 'c',
      siteOrigin: 'http://127.0.0.1:3000'
    })
  })

  it('site igual ao servidor de retorno do app → null (config trocada)', () => {
    expect(readNotionOAuthConfig('c', 'http://127.0.0.1:47821')).toBeNull()
    expect(readNotionOAuthConfig('c', new URL(NOTION_OAUTH_REDIRECT_URI).origin)).toBeNull()
  })

  it('sem client ID ou sem site → null (OAuth indisponível)', () => {
    expect(readNotionOAuthConfig(undefined, 'https://orkio.dev')).toBeNull()
    expect(readNotionOAuthConfig('c', null)).toBeNull()
    expect(readNotionOAuthConfig('c d', 'https://orkio.dev')).toBeNull()
  })
})

describe('buildNotionAuthorizeUrl', () => {
  it('monta a URL com client_id, owner=user, redirect_uri e state', () => {
    const url = new URL(buildNotionAuthorizeUrl('client-123', 'st4te'))
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-123',
      response_type: 'code',
      owner: 'user',
      redirect_uri: NOTION_OAUTH_REDIRECT_URI,
      state: 'st4te'
    })
  })
})

describe('parseNotionTokenResponse', () => {
  it('normaliza tokens, workspace e dono', () => {
    expect(parseNotionTokenResponse(TOKEN_RESPONSE)).toEqual({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      botId: 'bot-1',
      workspaceId: 'ws-1',
      workspaceName: 'Acme',
      workspaceIconUrl: 'https://s3.example.com/acme.png',
      ownerName: 'Ada Lovelace',
      ownerAvatarUrl: 'https://x/ada.png'
    })
  })

  it('ícone emoji, sem refresh_token e dono workspace', () => {
    expect(
      parseNotionTokenResponse({
        access_token: ACCESS,
        bot_id: 'b',
        workspace_icon: '🚀',
        owner: { type: 'workspace', workspace: true }
      })
    ).toMatchObject({ refreshToken: null, workspaceIconUrl: null, ownerName: null })
  })

  it('sem access_token ou bot_id → null', () => {
    expect(parseNotionTokenResponse({ bot_id: 'b' })).toBeNull()
    expect(parseNotionTokenResponse({ access_token: ACCESS })).toBeNull()
    expect(parseNotionTokenResponse('x')).toBeNull()
  })
})

describe('createNotionOAuthBroker', () => {
  it('troca o code no intermediário (sem client_secret no app)', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(TOKEN_RESPONSE))
    const broker = createNotionOAuthBroker(CONFIG, { fetch: fetchMock })

    const tokens = await broker.exchangeCode('code-1', NOTION_OAUTH_REDIRECT_URI)

    expect(tokens.accessToken).toBe(ACCESS)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://broker.example/notion/token')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      code: 'code-1',
      redirect_uri: NOTION_OAUTH_REDIRECT_URI
    })
    expect(JSON.stringify(init)).not.toMatch(/secret|Authorization/i)
  })

  it('renova com o refresh token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(TOKEN_RESPONSE))
    await createNotionOAuthBroker(CONFIG, { fetch: fetchMock }).refresh(REFRESH)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://broker.example/notion/refresh')
    expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: REFRESH })
  })

  it.each([
    [400, { error: 'invalid_grant' }, 'invalid_grant', /Conecte o Notion de novo/],
    [401, { error: 'invalid_client' }, 'oauth_config', /mal configurado/],
    [400, { error: 'redirect_uri_not_allowed' }, 'oauth_config', /endereço de retorno/],
    [429, {}, 'rate_limited', /Muitas tentativas/],
    [502, {}, 'server', /502/],
    [400, { error: 'invalid_request' }, 'unexpected', /HTTP 400/]
  ])('HTTP %i %j → %s', async (status, body, code, message) => {
    const broker = createNotionOAuthBroker(CONFIG, { fetch: async () => json(body, status) })
    const error = await broker.refresh(REFRESH).catch((e: unknown) => e)
    expect(error).toMatchObject({ code })
    expect((error as Error).message).toMatch(message)
    expectNoLeak(error)
  })

  it('resposta 200 sem tokens → unexpected', async () => {
    const broker = createNotionOAuthBroker(CONFIG, { fetch: async () => json({ ok: true }) })
    await expect(broker.exchangeCode('c', 'r')).rejects.toMatchObject({ code: 'unexpected' })
  })

  it('erro de rede e timeout, sem vazar tokens', async () => {
    const offline = createNotionOAuthBroker(CONFIG, {
      fetch: async () => {
        throw new TypeError(`fetch failed ${REFRESH}`)
      }
    })
    const networkError = await offline.refresh(REFRESH).catch((e: unknown) => e)
    expect(networkError).toMatchObject({ code: 'network' })
    expect((networkError as Error).message).toMatch(/broker\.example.*internet/)
    expectNoLeak(networkError)

    const localSite = createNotionOAuthBroker(
      { clientId: 'c', siteOrigin: 'http://127.0.0.1:3000' },
      {
        fetch: async () => {
          throw new TypeError('fetch failed')
        }
      }
    )
    const localError = await localSite.refresh(REFRESH).catch((e: unknown) => e)
    expect(localError).toMatchObject({ code: 'network' })
    expect((localError as Error).message).toMatch(/127\.0\.0\.1:3000.*pnpm --dir site dev/)
    expect((localError as Error).message).not.toMatch(/internet/)

    const slow = createNotionOAuthBroker(CONFIG, {
      timeoutMs: 10,
      fetch: (_u, init) =>
        new Promise((_r, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    })
    await expect(slow.refresh(REFRESH)).rejects.toMatchObject({ code: 'timeout' })
  })
})

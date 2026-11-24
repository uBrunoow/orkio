import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brokerPost } from './broker-route'
import { NOTION_OAUTH_REDIRECT_URI } from './contract'
import { NOTION_TOKEN_URL, tokenUrlFrom, type BrokerEnv } from './notion-broker'
import { clientIp, createRateLimiter } from './rate-limit'

const ENV: BrokerEnv = {
  NOTION_CLIENT_ID: 'id',
  NOTION_CLIENT_SECRET: 'secret_NUNCA_NA_RESPOSTA',
  ALLOWED_REDIRECT_URIS: NOTION_OAUTH_REDIRECT_URI
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

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

describe('limitador por IP (defesa mínima)', () => {
  it('libera até o limite na janela e devolve os segundos de espera', () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t })
    expect(limiter.check('1.1.1.1')).toBeNull()
    expect(limiter.check('1.1.1.1')).toBeNull()
    expect(limiter.check('1.1.1.1')).toBe(60)
    expect(limiter.check('2.2.2.2')).toBeNull() // outro IP
    t = 61_000
    expect(limiter.check('1.1.1.1')).toBeNull()
  })

  it('não cresce sem limite com IPs variados', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3, now: () => 0 })
    for (const ip of ['a', 'b', 'c', 'd']) expect(limiter.check(ip)).toBeNull()
    expect(limiter.check('a')).toBeNull() // "a" foi descartado
  })

  it('IP vem do x-forwarded-for (primeiro valor)', () => {
    const r = new Request('https://x/', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } })
    expect(clientIp(r)).toBe('9.9.9.9')
  })

  it('a rota responde 429 com Retry-After antes de chamar o Notion', async () => {
    const upstream = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', upstream)
    vi.stubEnv('NOTION_CLIENT_ID', 'id')
    vi.stubEnv('NOTION_CLIENT_SECRET', 'secret')
    const limiter = createRateLimiter({ limit: 0, windowMs: 60_000 })
    const res = await brokerPost(
      'refresh',
      new Request('https://x/notion/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"refresh_token":"r"}'
      }),
      limiter
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('endpoint de token', () => {
  it('na Vercel, sempre o do Notion; fora dela, só um loopback explícito', () => {
    expect(tokenUrlFrom(ENV)).toBe(NOTION_TOKEN_URL)
    expect(tokenUrlFrom({ ...ENV, NOTION_TOKEN_URL: 'http://127.0.0.1:9/token' })).toBe(
      'http://127.0.0.1:9/token'
    )
    expect(
      tokenUrlFrom({ ...ENV, NOTION_TOKEN_URL: 'http://127.0.0.1:9/token', VERCEL: '1' })
    ).toBe(NOTION_TOKEN_URL)
    expect(tokenUrlFrom({ ...ENV, NOTION_TOKEN_URL: 'https://evil.example/token' })).toBe(
      NOTION_TOKEN_URL
    )
    expect(tokenUrlFrom({ ...ENV, NOTION_TOKEN_URL: 'http://localhost.evil/x' })).toBe(
      NOTION_TOKEN_URL
    )
  })

  it('a rota real lê as variáveis do processo (sem secret → 500)', async () => {
    vi.stubEnv('NOTION_CLIENT_ID', 'id')
    vi.stubEnv('NOTION_CLIENT_SECRET', '')
    const res = await brokerPost(
      'token',
      new Request('https://x/notion/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' },
        body: '{}'
      })
    )
    expect(res.status).toBe(500)
  })
})

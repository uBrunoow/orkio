import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brokerPost } from './broker-route'
import { NOTION_TOKEN_URL, tokenUrlFrom, type BrokerEnv } from './notion-broker'
import { clientIp, createRateLimiter } from './rate-limit'

const ENV: BrokerEnv = {
  NOTION_CLIENT_ID: 'id',
  NOTION_CLIENT_SECRET: 'secret_NUNCA_NA_RESPOSTA',
  ALLOWED_REDIRECT_URIS: 'http://localhost:47821/oauth/notion/callback'
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
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

describe('sem logs', () => {
  it('nenhum console.* no intermediário (corpo, tokens e headers nunca vão para o log)', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p)
      }
    }
    walk(join(import.meta.dirname))
    walk(join(import.meta.dirname, '..', 'app', 'notion'))
    walk(join(import.meta.dirname, '..', 'app', 'health'))
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.\w+\s*\(/)
  })
})

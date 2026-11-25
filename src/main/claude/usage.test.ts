import { describe, expect, it, vi } from 'vitest'
import {
  CACHE_MS,
  NO_LOGIN_CACHE_MS,
  CLAUDE_USAGE_BETA,
  CLAUDE_USAGE_URL,
  ClaudeUsageService,
  accessTokenFrom
} from './usage'
import { headlineWindow, parseClaudeUsage } from '../../shared/claude-usage'

const TOKEN = 'sk-ant-oat01-SEGREDO-DO-CLAUDE-CODE'
const NOW = Date.parse('2026-11-24T12:00:00Z')
const credentials = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    claudeAiOauth: { accessToken: TOKEN, expiresAt: NOW + 3_600_000, ...over }
  })
const BODY = {
  five_hour: { utilization: 42.4, resets_at: '2026-11-24T14:30:00.000+00:00' },
  seven_day: { utilization: 18, resets_at: '2026-11-30T09:00:00Z' },
  seven_day_opus: null
}

function service(
  opts: {
    enabled?: boolean
    creds?: string | null
    response?: () => Response | Promise<Response>
    now?: () => number
  } = {}
) {
  const fetch = vi.fn(async () =>
    opts.response ? opts.response() : new Response(JSON.stringify(BODY), { status: 200 })
  )
  const svc = new ClaudeUsageService({
    enabled: () => opts.enabled ?? true,
    readCredentials: async () => (opts.creds === undefined ? credentials() : opts.creds),
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: opts.now ?? (() => NOW)
  })
  return { svc, fetch }
}

describe('accessTokenFrom', () => {
  it('lê o token do Claude Code; vencido, malformado ou ausente = null', () => {
    expect(accessTokenFrom(credentials(), NOW)).toBe(TOKEN)
    expect(accessTokenFrom(credentials({ expiresAt: NOW - 1 }), NOW)).toBeNull()
    expect(accessTokenFrom(credentials({ accessToken: 'com espaço no meio' }), NOW)).toBeNull()
    expect(accessTokenFrom('{nada', NOW)).toBeNull()
    expect(accessTokenFrom(JSON.stringify({ outro: {} }), NOW)).toBeNull()
  })
})

describe('parseClaudeUsage', () => {
  it('pega as janelas de 5 h e semanal, arredonda e normaliza o horário', () => {
    expect(parseClaudeUsage(BODY, new Date(NOW))).toEqual({
      session: { percent: 42, resetsAt: '2026-11-24T14:30:00.000Z' },
      weekly: { percent: 18, resetsAt: '2026-11-30T09:00:00.000Z' },
      checkedAt: new Date(NOW).toISOString()
    })
  })
  it('formato estranho = null; valores fora da faixa são limitados ou ignorados', () => {
    expect(parseClaudeUsage({}, new Date(NOW))).toBeNull()
    expect(parseClaudeUsage([], new Date(NOW))).toBeNull()
    expect(parseClaudeUsage({ five_hour: { utilization: -3 } }, new Date(NOW))).toBeNull()
    const over = parseClaudeUsage({ seven_day: { utilization: 140, resets_at: 'x' } }, new Date())
    expect(over?.weekly).toEqual({ percent: 100, resetsAt: null })
    expect(over?.session).toBeNull()
  })
  it('o destaque é a janela mais cheia', () => {
    const u = parseClaudeUsage(BODY, new Date(NOW))!
    expect(headlineWindow(u)?.kind).toBe('session')
    expect(headlineWindow({ ...u, weekly: { percent: 90, resetsAt: null } })?.kind).toBe('weekly')
  })
})

describe('ClaudeUsageService', () => {
  it('chama o endpoint com o token do Claude Code e devolve só % e horários', async () => {
    const { svc, fetch } = service()
    const usage = await svc.get()
    expect(usage?.session?.percent).toBe(42)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(CLAUDE_USAGE_URL)
    const headers = init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(headers['anthropic-beta']).toBe(CLAUDE_USAGE_BETA)
    expect(init?.redirect).toBe('error')
    expect(JSON.stringify(usage)).not.toContain(TOKEN)
  })

  it('cache curto: uma consulta por minuto, e uma só quando chegam juntas', async () => {
    let now = NOW
    const { svc, fetch } = service({ now: () => now })
    await Promise.all([svc.get(), svc.get()])
    expect(fetch).toHaveBeenCalledTimes(1)
    now += CACHE_MS - 1
    await svc.get()
    expect(fetch).toHaveBeenCalledTimes(1)
    now += 2
    await svc.get()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('desligado: não lê credenciais nem chama a rede', async () => {
    const read = vi.fn()
    const { fetch } = service()
    const svc = new ClaudeUsageService({
      enabled: () => false,
      readCredentials: read,
      fetch: fetch as unknown as typeof globalThis.fetch
    })
    expect(await svc.get()).toBeNull()
    expect(read).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sem login, token vencido, 401, rede fora ou corpo estranho: some sem erro', async () => {
    expect(await service({ creds: null }).svc.get()).toBeNull()
    const expired = service({ creds: credentials({ expiresAt: NOW - 1 }) })
    expect(await expired.svc.get()).toBeNull()
    expect(expired.fetch).not.toHaveBeenCalled()
    const denied = service({ response: () => new Response('{"error":"x"}', { status: 401 }) })
    expect(await denied.svc.get()).toBeNull()
    const down = service({
      response: () => {
        throw new TypeError(`fetch failed ${TOKEN}`)
      }
    })
    await expect(down.svc.get()).resolves.toBeNull()
    expect(await service({ response: () => new Response('<html>') }).svc.get()).toBeNull()
  })

  it('sem login: espera mais para tentar de novo (não pede o Keychain a cada minuto)', async () => {
    let now = NOW
    const read = vi.fn(async () => null)
    const svc = new ClaudeUsageService({
      enabled: () => true,
      readCredentials: read,
      now: () => now
    })
    await svc.get()
    now += CACHE_MS * 2
    await svc.get()
    expect(read).toHaveBeenCalledTimes(1)
    now += NO_LOGIN_CACHE_MS
    await svc.get()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reset esquece o cache (religar o medidor consulta de novo)', async () => {
    const { svc, fetch } = service()
    await svc.get()
    svc.reset()
    await svc.get()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

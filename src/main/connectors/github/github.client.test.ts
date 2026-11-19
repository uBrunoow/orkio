import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_API_VERSION,
  GITHUB_REQUEST_TIMEOUT_MS,
  GitHubApiError,
  createGitHubClient,
  parseUser,
  rateLimitWaitMs
} from './github.client'

const TOKEN = 'github_pat_TEST_TOKEN_SHOULD_NEVER_LEAK'
const NOW = Date.parse('2026-11-19T12:00:00Z')

const USER = {
  login: 'octocat',
  id: 583231,
  name: 'The Octocat',
  avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4'
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function expectNoLeak(error: unknown): void {
  expect(String(error)).not.toContain(TOKEN)
  expect(JSON.stringify(error)).not.toContain(TOKEN)
  expect((error as Error).stack ?? '').not.toContain(TOKEN)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createGitHubClient().getUser', () => {
  it('chama GET /user com Bearer, Accept, X-GitHub-Api-Version e User-Agent', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(USER))
    await createGitHubClient({ fetch: fetchMock }).getUser(TOKEN)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.github.com/user')
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'Orkio-Desktop'
    })
    expect(GITHUB_API_VERSION).toBe('2026-03-10')
  })

  it('token válido → login, nome, avatar e escopos', async () => {
    const client = createGitHubClient({
      fetch: async () => json(USER, 200, { 'X-OAuth-Scopes': 'repo, read:org' })
    })
    await expect(client.getUser(TOKEN)).resolves.toEqual({
      id: 583231,
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: USER.avatar_url,
      scopes: ['repo', 'read:org']
    })
  })

  it('fine-grained PAT (sem X-OAuth-Scopes) → scopes null', async () => {
    const client = createGitHubClient({ fetch: async () => json(USER) })
    expect((await client.getUser(TOKEN)).scopes).toBeNull()
  })

  it('401 → unauthorized, sem vazar o token', async () => {
    const client = createGitHubClient({
      fetch: async () => json({ message: 'Bad credentials' }, 401)
    })
    const error = await client.getUser(TOKEN).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubApiError)
    expect(error).toMatchObject({ code: 'unauthorized', status: 401 })
    expect((error as Error).message).toMatch(/inválido, expirado ou revogado/)
    expectNoLeak(error)
  })

  it('403 sem sinais de rate limit → forbidden', async () => {
    const client = createGitHubClient({
      fetch: async () => json({ message: 'Resource not accessible' }, 403)
    })
    await expect(client.getUser(TOKEN)).rejects.toMatchObject({ code: 'forbidden' })
  })

  describe('rate limit primário (x-ratelimit-remaining: 0)', () => {
    it('reset longe → erro com o tempo de espera, sem nova tentativa', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        json({ message: 'API rate limit exceeded' }, 403, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(NOW / 1000 + 600)
        })
      )
      const sleep = vi.fn(async () => {})
      const client = createGitHubClient({ fetch: fetchMock, sleep, now: () => NOW })

      const error = await client.getUser(TOKEN).catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'rate_limited' })
      expect((error as Error).message).toBe(
        'Limite de requisições do GitHub atingido. Tente novamente em 10 min.'
      )
      expect(sleep).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reset em poucos segundos → espera e tenta de novo uma vez', async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          json({}, 429, {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(NOW / 1000 + 3)
          })
        )
        .mockResolvedValueOnce(json(USER))
      const sleep = vi.fn(async () => {})
      const client = createGitHubClient({ fetch: fetchMock, sleep, now: () => NOW })

      await expect(client.getUser(TOKEN)).resolves.toMatchObject({ login: 'octocat' })
      expect(sleep).toHaveBeenCalledWith(3000)
    })
  })

  describe('rate limit secundário', () => {
    it('403 com Retry-After curto → espera e tenta de novo', async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({}, 403, { 'Retry-After': '2' }))
        .mockResolvedValueOnce(json(USER))
      const sleep = vi.fn(async () => {})
      await expect(
        createGitHubClient({ fetch: fetchMock, sleep }).getUser(TOKEN)
      ).resolves.toMatchObject({ login: 'octocat' })
      expect(sleep).toHaveBeenCalledWith(2000)
    })

    it('429 com Retry-After longo → erro "diminuir o ritmo"', async () => {
      const client = createGitHubClient({
        fetch: async () => json({}, 429, { 'Retry-After': '90' }),
        sleep: async () => {}
      })
      const error = await client.getUser(TOKEN).catch((e: unknown) => e)
      expect((error as Error).message).toBe(
        'O GitHub pediu para diminuir o ritmo. Tente novamente em 90 s.'
      )
    })

    it('403 "secondary rate limit" sem header → espera padrão de 1 min', async () => {
      const client = createGitHubClient({
        fetch: async () => json({ message: 'You have exceeded a secondary rate limit.' }, 403),
        sleep: async () => {}
      })
      await expect(client.getUser(TOKEN)).rejects.toMatchObject({
        code: 'rate_limited',
        message: expect.stringContaining('em 60 s')
      })
    })

    it('desiste após a segunda resposta de rate limit', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => json({}, 429, { 'Retry-After': '1' }))
      const client = createGitHubClient({ fetch: fetchMock, sleep: async () => {} })
      await expect(client.getUser(TOKEN)).rejects.toMatchObject({ code: 'rate_limited' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('timeout de 10 s → erro timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error(`aborted ${TOKEN}`)))
        })
    )
    const pending = createGitHubClient({ fetch: fetchMock })
      .getUser(TOKEN)
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(GITHUB_REQUEST_TIMEOUT_MS)
    const error = await pending
    expect(error).toMatchObject({ code: 'timeout' })
    expectNoLeak(error)
  })

  it('erro de rede → network sem expor a exceção original', async () => {
    const client = createGitHubClient({
      fetch: async () => {
        throw new TypeError(`fetch failed ENOTFOUND ${TOKEN}`)
      }
    })
    const error = await client.getUser(TOKEN).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'network' })
    expect((error as Error).message).not.toMatch(/ENOTFOUND/)
    expectNoLeak(error)
  })

  it.each([500, 502, 503])('%i → server', async (status) => {
    const client = createGitHubClient({ fetch: async () => new Response('x', { status }) })
    await expect(client.getUser(TOKEN)).rejects.toMatchObject({ code: 'server', status })
  })

  it('corpo inválido → unexpected', async () => {
    const client = createGitHubClient({ fetch: async () => json({ message: 'hi' }) })
    await expect(client.getUser(TOKEN)).rejects.toMatchObject({ code: 'unexpected' })
  })
})

describe('rateLimitWaitMs', () => {
  it('ignora status que não são 403/429 e 403 comum', () => {
    expect(rateLimitWaitMs(new Response('', { status: 500 }), '', NOW)).toBeNull()
    expect(rateLimitWaitMs(new Response('', { status: 403 }), 'Forbidden', NOW)).toBeNull()
  })
})

describe('parseUser', () => {
  it('nome ausente e avatar não-https', () => {
    expect(parseUser({ login: 'x', id: 1, name: null, avatar_url: 'http://a' }, null)).toEqual({
      id: 1,
      login: 'x',
      name: null,
      avatarUrl: null,
      scopes: null
    })
    expect(parseUser({ id: 1 }, null)).toBeNull()
  })
})

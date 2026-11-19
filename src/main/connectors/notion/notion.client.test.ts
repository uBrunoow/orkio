import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NOTION_REQUEST_TIMEOUT_MS,
  NOTION_VERSION,
  NotionApiError,
  createNotionClient,
  parseRetryAfterMs,
  parseSelf
} from './notion.client'
import { RateQueue } from '../../net/rate-queue'

const TOKEN = 'ntn_test_token_SHOULD_NEVER_LEAK'

const PERSON_RESPONSE = {
  object: 'user',
  id: 'd40e767c-d7af-4b18-a86d-55c61f1e39a4',
  type: 'person',
  name: 'Ada Lovelace',
  avatar_url: 'https://s3.example.com/ada.png',
  person: { email: 'ada@example.com' }
}

const BOT_RESPONSE = {
  object: 'user',
  id: '16d84278-ab0e-484c-9bdd-b35da3bd8905',
  type: 'bot',
  name: 'Orkio Integration',
  avatar_url: null,
  bot: {
    owner: {
      type: 'user',
      user: {
        object: 'user',
        id: 'aaaa',
        name: 'Grace Hopper',
        avatar_url: 'https://s3.example.com/grace.png',
        type: 'person'
      }
    },
    workspace_name: 'Acme Labs'
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

function expectNoTokenLeak(error: unknown): void {
  expect(String(error)).not.toContain(TOKEN)
  expect(JSON.stringify(error)).not.toContain(TOKEN)
  expect((error as Error).stack ?? '').not.toContain(TOKEN)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createNotionClient().getSelf', () => {
  it('chama /v1/users/me com Bearer e Notion-Version', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(PERSON_RESPONSE))
    const client = createNotionClient({ fetch: fetchMock })

    await client.getSelf(TOKEN)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.notion.com/v1/users/me')
    expect(init?.method).toBe('GET')
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': NOTION_VERSION
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('token válido (PAT) → devolve o usuário normalizado', async () => {
    const client = createNotionClient({ fetch: async () => jsonResponse(PERSON_RESPONSE) })
    await expect(client.getSelf(TOKEN)).resolves.toEqual({
      id: PERSON_RESPONSE.id,
      type: 'person',
      name: 'Ada Lovelace',
      avatarUrl: 'https://s3.example.com/ada.png',
      ownerName: null,
      ownerAvatarUrl: null,
      workspaceName: null
    })
  })

  it('token de integração (bot) → inclui dono e workspace', async () => {
    const client = createNotionClient({ fetch: async () => jsonResponse(BOT_RESPONSE) })
    await expect(client.getSelf(TOKEN)).resolves.toMatchObject({
      type: 'bot',
      name: 'Orkio Integration',
      ownerName: 'Grace Hopper',
      ownerAvatarUrl: 'https://s3.example.com/grace.png',
      workspaceName: 'Acme Labs'
    })
  })

  it('401 → erro unauthorized com mensagem acionável, sem vazar token', async () => {
    const client = createNotionClient({
      fetch: async () =>
        jsonResponse({ object: 'error', status: 401, code: 'unauthorized' }, { status: 401 })
    })
    const error = await client.getSelf(TOKEN).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotionApiError)
    expect(error).toMatchObject({ code: 'unauthorized', status: 401 })
    expect((error as Error).message).toMatch(/Token inválido/)
    expectNoTokenLeak(error)
  })

  it('403 → erro forbidden', async () => {
    const client = createNotionClient({ fetch: async () => jsonResponse({}, { status: 403 }) })
    await expect(client.getSelf(TOKEN)).rejects.toMatchObject({ code: 'forbidden' })
  })

  describe('429 rate limit', () => {
    it('respeita Retry-After curto e tenta de novo uma vez', async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
        .mockResolvedValueOnce(jsonResponse(PERSON_RESPONSE))
      const sleep = vi.fn(async () => {})
      const client = createNotionClient({ fetch: fetchMock, sleep })

      await expect(client.getSelf(TOKEN)).resolves.toMatchObject({ name: 'Ada Lovelace' })
      expect(sleep).toHaveBeenCalledWith(2000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('não tenta de novo se Retry-After for longo; informa o tempo de espera', async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } })
      )
      const sleep = vi.fn(async () => {})
      const client = createNotionClient({ fetch: fetchMock, sleep })

      const error = await client.getSelf(TOKEN).catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'rate_limited', status: 429 })
      expect((error as Error).message).toContain('em 30 s')
      expect(sleep).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('desiste após a segunda resposta 429', async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 429, headers: { 'Retry-After': '1' } })
      )
      const client = createNotionClient({ fetch: fetchMock, sleep: async () => {} })

      await expect(client.getSelf(TOKEN)).rejects.toMatchObject({ code: 'rate_limited' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('sem Retry-After → erro sem esperar', async () => {
      const sleep = vi.fn(async () => {})
      const client = createNotionClient({
        fetch: async () => new Response(null, { status: 429 }),
        sleep
      })
      const error = await client.getSelf(TOKEN).catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'rate_limited' })
      expect((error as Error).message).toContain('em alguns segundos')
      expect(sleep).not.toHaveBeenCalled()
    })
  })

  it('timeout de 10 s → erro timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException(`aborted ${TOKEN}`, 'AbortError'))
          )
        })
    )
    const client = createNotionClient({ fetch: fetchMock })

    const pending = client.getSelf(TOKEN).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(NOTION_REQUEST_TIMEOUT_MS - 1)
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const error = await pending
    expect(error).toMatchObject({ code: 'timeout' })
    expect((error as Error).message).toMatch(/demorou demais/)
    expectNoTokenLeak(error)
  })

  it('erro de rede → erro network sem expor a exceção original', async () => {
    const client = createNotionClient({
      fetch: async () => {
        throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND (${TOKEN})`)
      }
    })
    const error = await client.getSelf(TOKEN).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'network' })
    expect((error as Error).message).toMatch(/conexão com a internet/)
    expect((error as Error).message).not.toMatch(/ENOTFOUND|fetch failed/)
    expectNoTokenLeak(error)
  })

  it.each([500, 502, 503])('%i → erro server', async (status) => {
    const client = createNotionClient({ fetch: async () => new Response('oops', { status }) })
    const error = await client.getSelf(TOKEN).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'server', status })
    expect((error as Error).message).toContain(String(status))
  })

  it('400 (ex.: versão inválida) → erro unexpected', async () => {
    const client = createNotionClient({ fetch: async () => jsonResponse({}, { status: 400 }) })
    await expect(client.getSelf(TOKEN)).rejects.toMatchObject({ code: 'unexpected', status: 400 })
  })

  it('JSON inválido ou formato desconhecido → erro unexpected', async () => {
    const notJson = createNotionClient({
      fetch: async () => new Response('<html>', { status: 200 })
    })
    await expect(notJson.getSelf(TOKEN)).rejects.toMatchObject({ code: 'unexpected' })

    const wrongShape = createNotionClient({ fetch: async () => jsonResponse({ object: 'list' }) })
    await expect(wrongShape.getSelf(TOKEN)).rejects.toMatchObject({ code: 'unexpected' })
  })
})

describe('parseRetryAfterMs', () => {
  it('aceita segundos e datas HTTP', () => {
    expect(parseRetryAfterMs('3')).toBe(3000)
    expect(parseRetryAfterMs('0.5')).toBe(500)
    const now = Date.parse('2026-11-19T12:00:00Z')
    expect(parseRetryAfterMs('Thu, 19 Nov 2026 12:00:04 GMT', now)).toBe(4000)
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('amanhã')).toBeNull()
  })
})

describe('parseSelf', () => {
  it('ignora avatar que não é https', () => {
    expect(
      parseSelf({ ...PERSON_RESPONSE, avatar_url: 'javascript:alert(1)' })?.avatarUrl
    ).toBeNull()
    expect(
      parseSelf({ ...PERSON_RESPONSE, avatar_url: 'http://x.com/a.png' })?.avatarUrl
    ).toBeNull()
  })

  it('bot de workspace (sem dono usuário)', () => {
    const parsed = parseSelf({
      ...BOT_RESPONSE,
      bot: { owner: { type: 'workspace', workspace: true }, workspace_name: 'Acme' }
    })
    expect(parsed).toMatchObject({ ownerName: null, workspaceName: 'Acme' })
  })
})

describe('leituras de dados (data sources)', () => {
  const DS = '22222222-2222-2222-2222-222222222222'

  function setup(responses: (() => Response)[], random = () => 0) {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const next = responses.shift()
      if (!next) throw new Error('sem resposta')
      return next()
    })
    const queue = new RateQueue({ concurrency: 1, minIntervalMs: 0 })
    const client = createNotionClient({ fetch: fetchMock, queue, random })
    const call = (i: number) => {
      const [url, init] = fetchMock.mock.calls[i]!
      return {
        url: String(url),
        method: init?.method,
        headers: init?.headers as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      }
    }
    return { client, fetchMock, call }
  }

  const page = (results: unknown[], next: string | null) =>
    jsonResponse({ object: 'list', results, has_more: next !== null, next_cursor: next })

  it('searchDataSources: POST /search filtrando data sources, com cursor e busca', async () => {
    const { client, call } = setup([() => page([{ id: 'a' }], 'c2')])
    const result = await client.searchDataSources(TOKEN, { query: 'Tarefas', startCursor: 'c1' })
    expect(result).toEqual({ results: [{ id: 'a' }], nextCursor: 'c2' })
    const req = call(0)
    expect(req.url).toBe('https://api.notion.com/v1/search')
    expect(req.method).toBe('POST')
    expect(req.headers['Notion-Version']).toBe(NOTION_VERSION)
    expect(req.headers['Content-Type']).toBe('application/json')
    expect(req.body).toMatchObject({
      query: 'Tarefas',
      start_cursor: 'c1',
      filter: { property: 'object', value: 'data_source' },
      page_size: 100
    })
  })

  it('queryDataSource: filtro de relação, ordenação e filter_properties', async () => {
    const { client, call } = setup([() => page([], null)])
    const filter = { property: 'rel', relation: { contains: 'proj-1' } }
    const result = await client.queryDataSource(TOKEN, DS, {
      filter,
      sorts: [{ property: 'uid', direction: 'ascending' }],
      startCursor: 'next',
      filterProperties: ['title', 'st%3A']
    })
    expect(result).toEqual({ results: [], nextCursor: null })
    const req = call(0)
    expect(req.url).toBe(
      `https://api.notion.com/v1/data_sources/${DS}/query?filter_properties[]=title&filter_properties[]=st%253A`
    )
    expect(req.body).toEqual({
      page_size: 100,
      filter,
      sorts: [{ property: 'uid', direction: 'ascending' }],
      start_cursor: 'next'
    })
  })

  it('has_more false ignora next_cursor; resposta sem results é inesperada', async () => {
    const { client } = setup([
      () => jsonResponse({ results: [], has_more: false, next_cursor: 'x' }),
      () => jsonResponse({ object: 'error' })
    ])
    expect((await client.queryDataSource(TOKEN, DS)).nextCursor).toBeNull()
    await expect(client.queryDataSource(TOKEN, DS)).rejects.toMatchObject({ code: 'unexpected' })
  })

  it('429 com Retry-After: pausa a fila e tenta de novo', async () => {
    const { client, fetchMock } = setup([
      () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
      () => page([{ id: 'ok' }], null)
    ])
    expect((await client.getDataSource(TOKEN, DS)) as unknown).toMatchObject({
      results: [{ id: 'ok' }]
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('429 sem Retry-After: backoff exponencial e desiste após 3 novas tentativas', async () => {
    vi.useFakeTimers()
    const limited = () => new Response('{}', { status: 429 })
    const { client, fetchMock } = setup([limited, limited, limited, limited])
    const result = client.queryDataSource(TOKEN, DS).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1) // 1 s
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000) // 2 s
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4000) // 4 s
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const error = await result
    expect(error).toBeInstanceOf(NotionApiError)
    expect(error).toMatchObject({ code: 'rate_limited' })
    expectNoTokenLeak(error)
  })

  it('429 pedindo espera longa demais não tenta de novo', async () => {
    const { client, fetchMock } = setup([
      () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } })
    ])
    await expect(client.getDataSource(TOKEN, DS)).rejects.toMatchObject({ code: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('404/403/400 viram mensagens específicas, sem vazar token', async () => {
    const { client } = setup([
      () => new Response('{}', { status: 404 }),
      () => new Response('{}', { status: 403 }),
      () => new Response(JSON.stringify({ message: TOKEN }), { status: 400 })
    ])
    for (const code of ['not_found', 'forbidden', 'bad_request']) {
      const error = await client.getDataSource(TOKEN, DS).catch((e: unknown) => e)
      expect(error).toMatchObject({ code })
      expectNoTokenLeak(error)
    }
  })

  it('a fila limita a concorrência das leituras', async () => {
    let active = 0
    let peak = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return page([], null)
    })
    const client = createNotionClient({
      fetch: fetchMock,
      queue: new RateQueue({ concurrency: 2, minIntervalMs: 0 })
    })
    await Promise.all(Array.from({ length: 6 }, () => client.queryDataSource(TOKEN, DS)))
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(peak).toBe(2)
  })
})

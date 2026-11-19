import { describe, expect, it, vi } from 'vitest'
import {
  GitHubApiError,
  createGitHubClient,
  parseNextLink,
  parsePullItem,
  type ConditionalPage
} from '../connectors/github/github.client'
import {
  GitHubRepoSignals,
  detailsQuery,
  parseDetails,
  SIGNALS_LIMITS,
  type GitHubSignalsApi
} from './github-signals.source'

const TOKEN = 'gho_SIGNALS_SECRET_TOKEN'
const NOW = Date.parse('2026-11-19T12:00:00Z')
const day = 24 * 60 * 60 * 1000

const pull = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  html_url: `https://github.com/acme/app/pull/${n}`,
  state: 'open',
  draft: false,
  merged_at: null,
  updated_at: new Date(NOW - day).toISOString(),
  head: { ref: `branch-${n}` },
  ...over
})

describe('client: GET condicional, Link e GraphQL', () => {
  it('manda If-None-Match; 304 → notModified; 200 traz ETag e próxima página', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = init?.headers as Record<string, string>
      if (headers['If-None-Match'] === 'W/"abc"') return new Response(null, { status: 304 })
      return new Response(JSON.stringify([pull(1)]), {
        status: 200,
        headers: {
          etag: 'W/"abc"',
          link: '<https://api.github.com/repositories/9/pulls?page=2>; rel="next", <https://api.github.com/repositories/9/pulls?page=5>; rel="last"'
        }
      })
    })
    const client = createGitHubClient({ fetch: fetchMock })
    const first = await client.getConditional(TOKEN, '/repos/acme/app/pulls', null)
    expect(first).toMatchObject({
      notModified: false,
      etag: 'W/"abc"',
      nextPath: '/repositories/9/pulls?page=2'
    })
    expect(await client.getConditional(TOKEN, '/repos/acme/app/pulls', 'W/"abc"')).toEqual({
      notModified: true
    })
    const headers = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>
    expect(headers['If-None-Match']).toBe('W/"abc"')
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('Link só aceita api.github.com', () => {
    expect(parseNextLink('<https://evil.example/x>; rel="next"')).toBeNull()
    expect(parseNextLink(null)).toBeNull()
    expect(parseNextLink('<https://api.github.com/x?page=3>; rel="next"')).toBe('/x?page=3')
  })

  it('GraphQL: dados parciais com erros por campo; sem dados + FORBIDDEN → erro sem vazar token', async () => {
    const responses = [
      { data: { repository: {} }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'pr1'] }] },
      { data: null, errors: [{ type: 'FORBIDDEN', message: TOKEN }] }
    ]
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(responses.shift()))
    )
    const client = createGitHubClient({ fetch: fetchMock })
    expect(await client.graphql(TOKEN, 'query { x }', {})).toEqual({
      data: { repository: {} },
      errors: [{ type: 'FORBIDDEN', path: ['repository', 'pr1'] }]
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.github.com/graphql')
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST')
    const error = await client.graphql(TOKEN, 'query { x }', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitHubApiError)
    expect(error).toMatchObject({ code: 'forbidden' })
    expect(String(error) + JSON.stringify(error)).not.toContain(TOKEN)
  })

  it('parsePullItem: estados e URL validada', () => {
    expect(parsePullItem(pull(1))).toMatchObject({
      state: 'open',
      merged: false,
      headRef: 'branch-1'
    })
    expect(parsePullItem(pull(2, { draft: true }))?.state).toBe('draft')
    expect(
      parsePullItem(pull(3, { state: 'closed', merged_at: '2026-11-18T00:00:00Z' }))
    ).toMatchObject({
      state: 'merged',
      merged: true
    })
    expect(parsePullItem(pull(4, { state: 'closed' }))?.state).toBe('closed')
    expect(parsePullItem(pull(5, { html_url: 'https://evil.example/acme/app/pull/5' }))).toBeNull()
    expect(parsePullItem(pull(6, { html_url: 'https://github.com/acme/app/issues/6' }))).toBeNull()
    expect(parsePullItem({ title: 'x' })).toBeNull()
  })
})

function fakeApi() {
  const pages: Record<string, { body: unknown; etag: string; next?: string }> = {}
  const api = {
    getConditional: vi.fn(async (path: string, etag: string | null): Promise<ConditionalPage> => {
      const page = pages[path]
      if (!page) return { notModified: false, body: [], etag: null, nextPath: null }
      if (etag === page.etag) return { notModified: true }
      return { notModified: false, body: page.body, etag: page.etag, nextPath: page.next ?? null }
    }),
    graphql: vi.fn<GitHubSignalsApi['graphql']>(async () => ({
      data: { repository: {} } as unknown,
      errors: []
    }))
  }
  return { api, pages }
}

const BASE = '/repos/acme/app'

describe('GitHubRepoSignals', () => {
  it('reaproveita o cache com 304 (ETag) e junta abertas + fechadas recentes', async () => {
    const { api, pages } = fakeApi()
    pages[`${BASE}/branches?per_page=100`] = {
      body: [{ name: 'main' }, { name: 'ORK-1/x' }],
      etag: 'b1'
    }
    pages[`${BASE}/pulls?state=open&per_page=100`] = {
      body: [pull(1), pull(2, { draft: true })],
      etag: 'o1'
    }
    pages[`${BASE}/pulls?state=closed&sort=updated&direction=desc&per_page=100`] = {
      body: [
        pull(3, { state: 'closed', merged_at: '2026-11-10T00:00:00Z' }),
        pull(4, { state: 'closed', updated_at: new Date(NOW - 40 * day).toISOString() })
      ],
      etag: 'c1'
    }
    const repo = new GitHubRepoSignals(api, 'acme', 'app', () => NOW)

    const first = await repo.snapshot()
    expect(first.branches).toEqual(['main', 'ORK-1/x'])
    expect(first.pulls.map((p) => [p.number, p.state])).toEqual([
      [1, 'open'],
      [2, 'draft'],
      [3, 'merged']
    ])
    expect(first.requests).toEqual({ notModified: 0, fetched: 3 })

    const second = await repo.snapshot()
    expect(second.requests).toEqual({ notModified: 3, fetched: 0 })
    expect(second.pulls).toEqual(first.pulls)
    expect(api.getConditional).toHaveBeenLastCalledWith(
      `${BASE}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
      'c1'
    )
  })

  it('pagina pelo Link e para no limite de páginas (truncado)', async () => {
    const { api, pages } = fakeApi()
    for (let i = 1; i <= 12; i++) {
      const path = i === 1 ? `${BASE}/branches?per_page=100` : `/repositories/9/branches?page=${i}`
      pages[path] = {
        body: [{ name: `b${i}` }],
        etag: `e${i}`,
        next: `/repositories/9/branches?page=${i + 1}`
      }
    }
    const repo = new GitHubRepoSignals(api, 'acme', 'app', () => NOW)
    const snap = await repo.snapshot()
    expect(snap.branches).toHaveLength(SIGNALS_LIMITS.branchPages)
    expect(snap.branchesTruncated).toBe(true)
  })

  it('fechadas: para de paginar quando passa da janela de 30 dias', async () => {
    const { api, pages } = fakeApi()
    pages[`${BASE}/pulls?state=closed&sort=updated&direction=desc&per_page=100`] = {
      body: [pull(9, { state: 'closed', updated_at: new Date(NOW - 31 * day).toISOString() })],
      etag: 'c',
      next: '/repositories/9/pulls?page=2'
    }
    const repo = new GitHubRepoSignals(api, 'acme', 'app', () => NOW)
    const snap = await repo.snapshot()
    expect(snap.pulls).toEqual([])
    expect(api.getConditional).not.toHaveBeenCalledWith('/repositories/9/pulls?page=2', null)
  })

  it('detalhes: só busca o que mudou; aberta revê após 5 min; falha mantém cache', async () => {
    const { api } = fakeApi()
    let now = NOW
    api.graphql.mockImplementation(async () => ({
      data: {
        repository: {
          pr1: {
            reviewDecision: 'APPROVED',
            reviewThreads: {
              nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }]
            },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }
          }
        }
      },
      errors: []
    }))
    const repo = new GitHubRepoSignals(api, 'acme', 'app', () => now)
    const p1 = parsePullItem(pull(1))!
    expect((await repo.pullDetails([p1])).get(1)).toEqual({
      reviewDecision: 'approved',
      unresolvedComments: 2,
      checks: 'success'
    })
    await repo.pullDetails([p1])
    expect(api.graphql).toHaveBeenCalledTimes(1)
    now += SIGNALS_LIMITS.openDetailsTtlMs + 1
    api.graphql.mockRejectedValueOnce(new GitHubApiError('network', 'x'))
    expect((await repo.pullDetails([p1])).get(1)?.reviewDecision).toBe('approved')
    expect(repo.detailsWarning).toMatch(/Mostrando o que já se sabe/)
    expect(api.graphql).toHaveBeenCalledTimes(2)
  })

  it('query em lote só com números inteiros; parse tolera campos nulos', () => {
    const q = detailsQuery([1, 22, -3, 1.5])
    expect(q).toContain('pr1: pullRequest(number: 1)')
    expect(q).toContain('pr22: pullRequest(number: 22)')
    expect(q).not.toContain('-3')
    expect(q).not.toContain('1.5')
    expect(
      parseDetails(
        { repository: { pr7: { reviewDecision: null, reviewThreads: null, commits: null } } },
        [7, 8]
      )
    ).toEqual(new Map([[7, { reviewDecision: null, unresolvedComments: null, checks: null }]]))
  })
})

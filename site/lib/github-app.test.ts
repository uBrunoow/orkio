import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_API_URL,
  attribution,
  apiBaseFrom,
  createAppJwt,
  handleInstallation,
  handleReview,
  parsePrivateKey,
  reviewPost,
  type GitHubAppEnv
} from './github-app'
import { REVIEW_BODY_MAX, REVIEW_COMMENT_MAX, REVIEW_PATH_MAX, reviewUrlOrNull } from './contract'
import { createRateLimiter } from './rate-limit'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC = createPublicKey(privateKey)
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const USER_TOKEN = 'gho_USUARIO_NUNCA_NA_RESPOSTA_123'
const APP_TOKEN = 'ghs_TOKEN_DA_INSTALACAO_NUNCA_SAI_456'
const REVIEW_URL = 'https://github.com/acme/orkio/pull/7#pullrequestreview-99'

const ENV: GitHubAppEnv = {
  GITHUB_APP_ID: '123456',
  // Como a Vercel costuma guardar: uma linha só com "\n" literais.
  GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'),
  GITHUB_APP_SLUG: 'orkio'
}

interface Call {
  url: string
  method: string
  auth: string
  body: unknown
  redirect: string | undefined
}

type Route = 'repo' | 'user' | 'installation' | 'token' | 'review'

/** GitHub simulado: responde por rota e registra as chamadas. */
function fakeGitHub(overrides: Partial<Record<Route, () => Response>> = {}): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({
      url,
      method: init?.method ?? 'GET',
      auth: headers['Authorization'] ?? '',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      redirect: init?.redirect
    })
    const path = new URL(url).pathname
    if (path === '/repos/Acme/orkio') {
      return (
        overrides.repo?.() ??
        Response.json({ name: 'orkio', owner: { login: 'acme' }, permissions: { push: true } })
      )
    }
    if (path === '/user') {
      return overrides.user?.() ?? Response.json({ login: 'ana-dev', id: 1 })
    }
    if (path === '/repos/acme/orkio/installation') {
      return overrides.installation?.() ?? Response.json({ id: 42, body: 'nao repassar' })
    }
    if (path === '/app/installations/42/access_tokens') {
      return (
        overrides.token?.() ??
        Response.json({ token: APP_TOKEN, expires_at: '2026-11-23T13:00:00Z' }, { status: 201 })
      )
    }
    if (path === '/repos/acme/orkio/pulls/7/reviews') {
      return (
        overrides.review?.() ??
        Response.json({ id: 99, html_url: REVIEW_URL, user: { login: 'orkio[bot]' } })
      )
    }
    return Response.json({ message: 'Not Found' }, { status: 404 })
  }
  return { fetch: vi.fn(impl) as unknown as typeof fetch, calls }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://orkio.example/github/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

const VALID = {
  owner: 'Acme',
  repo: 'orkio',
  number: 7,
  userToken: USER_TOKEN,
  review: {
    event: 'REQUEST_CHANGES',
    body: 'Faltam testes.',
    comments: [{ path: 'src/a.ts', line: 10, side: 'RIGHT', body: 'Trate o erro aqui.' }]
  }
}

const withReview = (review: Record<string, unknown>) => ({
  ...VALID,
  review: { ...VALID.review, ...review }
})

function run(body: unknown, gh = fakeGitHub(), env: GitHubAppEnv = ENV): Promise<Response> {
  return handleReview(post(body), env, { fetch: gh.fetch, now: () => NOW })
}

/** Nenhuma resposta da rota traz tokens, JWT ou chave. */
function expectNoSecrets(text: string): void {
  for (const secret of [APP_TOKEN, USER_TOKEN, 'eyJ', 'PRIVATE KEY']) {
    expect(text).not.toContain(secret)
  }
}

let logs: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined)
  )
})
afterEach(() => {
  // Nada é logado em nenhum caminho (tokens, corpos, erros).
  for (const spy of logs) expect(spy).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe('JWT do App', () => {
  it('RS256 com iat −60 s, exp +9 min e iss = App ID; assinatura confere com a chave pública', () => {
    const key = parsePrivateKey(ENV.GITHUB_APP_PRIVATE_KEY)
    expect(key).not.toBeNull()
    const jwt = createAppJwt('123456', key!, NOW)
    const [h, p, s] = jwt.split('.')
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT'
    })
    const now = NOW / 1000
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({
      iat: now - 60,
      exp: now + 540,
      iss: '123456'
    })
    expect(
      verify('RSA-SHA256', Buffer.from(`${h}.${p}`), PUBLIC, Buffer.from(s!, 'base64url'))
    ).toBe(true)
  })

  it('aceita a chave com quebras reais ou "\\n" literais; recusa lixo', () => {
    expect(parsePrivateKey(PEM)).not.toBeNull()
    expect(parsePrivateKey(PEM.replace(/\n/g, '\\n'))).not.toBeNull()
    expect(parsePrivateKey('nao é chave')).toBeNull()
    expect(
      parsePrivateKey('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
    ).toBeNull()
    expect(parsePrivateKey(undefined)).toBeNull()
  })
})

describe('POST /github/review', () => {
  it('sucesso: push conferido, token restrito ao repo, revisão postada pelo site; devolve só { url }', async () => {
    const gh = fakeGitHub()
    const res = await run(VALID, gh)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ url: REVIEW_URL })
    // O token do App (e o do usuário), o JWT e a chave nunca aparecem na resposta.
    expectNoSecrets(text)

    expect(gh.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', `${GITHUB_API_URL}/repos/Acme/orkio`],
      ['GET', `${GITHUB_API_URL}/user`],
      ['GET', `${GITHUB_API_URL}/repos/acme/orkio/installation`],
      ['POST', `${GITHUB_API_URL}/app/installations/42/access_tokens`],
      ['POST', `${GITHUB_API_URL}/repos/acme/orkio/pulls/7/reviews`]
    ])
    const [repoCall, userCall, instCall, tokenCall, reviewCall] = gh.calls
    expect(repoCall!.auth).toBe(`Bearer ${USER_TOKEN}`)
    expect(userCall!.auth).toBe(`Bearer ${USER_TOKEN}`)
    expect(instCall!.auth).toMatch(/^Bearer eyJ/)
    expect(tokenCall!.auth).toBe(instCall!.auth)
    expect(tokenCall!.body).toEqual({
      repositories: ['orkio'],
      permissions: { pull_requests: 'write' }
    })
    expect(reviewCall!.auth).toBe(`Bearer ${APP_TOKEN}`)
    expect(reviewCall!.redirect).toBe('error')
    expect(tokenCall!.redirect).toBe('error')
  })

  it('o corpo enviado ao GitHub tem só os campos permitidos (nada é repassado do pedido)', async () => {
    const gh = fakeGitHub()
    const res = await run(
      {
        ...VALID,
        extra: 'x',
        review: {
          ...VALID.review,
          commit_id: 'abc',
          extra: 'y',
          comments: [
            { path: 'src/a.ts', line: 10, body: 'Sem side vira RIGHT.', start_line: 1, x: 2 }
          ]
        }
      },
      gh
    )
    expect(res.status).toBe(200)
    expect(gh.calls[4]!.body).toEqual({
      event: 'REQUEST_CHANGES',
      body: `Faltam testes.${attribution('ana-dev')}`,
      comments: [{ path: 'src/a.ts', line: 10, side: 'RIGHT', body: 'Sem side vira RIGHT.' }]
    })
  })

  it('APPROVE (e minúsculo, ausente ou outro) → 400 sem NENHUMA chamada ao GitHub', async () => {
    const gh = fakeGitHub()
    for (const event of ['APPROVE', 'approve', 'comment', 'DISMISS', undefined, null, 1]) {
      const res = await run(withReview({ event }), gh)
      expect(res.status, String(event)).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_request' })
    }
    expect(gh.calls).toHaveLength(0)
  })

  it('pedido fora das regras → 400 sem rede', async () => {
    const gh = fakeGitHub()
    const comment = (c: Record<string, unknown>) =>
      withReview({ comments: [{ path: 'a.ts', line: 1, body: 'x', ...c }] })
    const bad: unknown[] = [
      { ...VALID, owner: '../x' },
      { ...VALID, owner: '-acme' },
      { ...VALID, owner: 'a'.repeat(101) },
      { ...VALID, owner: 'acme/orkio' },
      { ...VALID, repo: '..' },
      { ...VALID, repo: 'orkio/pulls' },
      { ...VALID, repo: 'or kio' },
      { ...VALID, repo: 'orkio?x=1' },
      { ...VALID, number: 0 },
      { ...VALID, number: 1.5 },
      { ...VALID, number: 2 ** 31 + 1 },
      { ...VALID, number: '7' },
      { ...VALID, userToken: 'gho_x\r\nX-Injected: 1' },
      { ...VALID, userToken: '' },
      { owner: 'acme', repo: 'orkio', number: 7, review: VALID.review },
      { ...VALID, review: 'texto' },
      withReview({ body: '' }),
      withReview({ body: '   ' }),
      withReview({ body: 'x'.repeat(REVIEW_BODY_MAX + 1) }),
      withReview({ comments: 'x' }),
      withReview({
        comments: Array.from({ length: 51 }, (_, i) => ({ path: 'a.ts', line: i + 1, body: 'x' }))
      }),
      comment({ path: '' }),
      comment({ path: 'a/../b' }),
      comment({ path: 'a\u0000b' }),
      comment({ path: 'p'.repeat(REVIEW_PATH_MAX + 1) }),
      comment({ line: 0 }),
      comment({ line: 2.5 }),
      comment({ side: 'LEFT' }),
      comment({ body: '' }),
      comment({ body: 'x'.repeat(REVIEW_COMMENT_MAX + 1) }),
      ['acme', 'orkio']
    ]
    for (const body of bad) {
      const res = await run(body, gh)
      expect(res.status, JSON.stringify(body).slice(0, 120)).toBe(400)
    }
    expect((await run('{x', gh)).status).toBe(400)
    expect(gh.calls).toHaveLength(0)
  })

  it('owner com "_" (conta gerenciada) é aceito', async () => {
    const gh = fakeGitHub({ repo: () => new Response('', { status: 404 }) })
    const res = await run({ ...VALID, owner: 'ana_acme' }, gh)
    expect(res.status).toBe(403) // passou da validação e foi ao GitHub
    expect(gh.calls).toHaveLength(1)
  })

  it('a revisão termina com "Publicado pelo Orkio a pedido de @login"', async () => {
    const gh = fakeGitHub()
    await run(VALID, gh)
    const sent = gh.calls.find((c) => c.url.endsWith('/reviews'))!.body as { body: string }
    expect(sent.body).toBe('Faltam testes.\n\n---\n_Publicado pelo Orkio a pedido de @ana-dev._')
  })

  it('login ausente ou fora do padrão do GitHub → forbidden, sem chamar o App', async () => {
    for (const user of [
      () => Response.json({ id: 1 }),
      () => Response.json({ login: 'ana](https://evil)' }),
      () => Response.json({ login: '-ana' }),
      () => Response.json({ login: 'a'.repeat(40) }),
      () => new Response('', { status: 401 })
    ]) {
      const gh = fakeGitHub({ user })
      const res = await run(VALID, gh)
      expect(res.status).toBe(403)
      expect(gh.calls).toHaveLength(2) // repo + user; nada do App
    }
    const ok = fakeGitHub({ user: () => Response.json({ login: 'ana_acme' }) })
    expect((await run(VALID, ok)).status).toBe(200)
  })

  it('sem permissão de push → 403 forbidden, sem chamar o App', async () => {
    const gh = fakeGitHub({
      repo: () =>
        Response.json({ name: 'orkio', owner: { login: 'acme' }, permissions: { push: false } })
    })
    const res = await run(VALID, gh)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(gh.calls).toHaveLength(1)
  })

  it('token do usuário recusado ou repo invisível → forbidden; rate limit → upstream', async () => {
    for (const status of [401, 403, 404]) {
      const gh = fakeGitHub({ repo: () => Response.json({ message: 'x' }, { status }) })
      expect((await run(VALID, gh)).status).toBe(403)
    }
    const limited = fakeGitHub({
      repo: () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
    })
    const res = await run(VALID, limited)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream' })
  })

  it('App não instalado → 412 not_installed com o link de instalação', async () => {
    const gh = fakeGitHub({
      installation: () => Response.json({ message: 'Not Found' }, { status: 404 })
    })
    const res = await run(VALID, gh)
    expect(res.status).toBe(412)
    expect(await res.json()).toEqual({
      error: 'not_installed',
      installUrl: 'https://github.com/apps/orkio/installations/new'
    })
    expect(gh.calls).toHaveLength(3)

    const noSlug = await run(
      VALID,
      fakeGitHub({ installation: () => new Response('', { status: 404 }) }),
      { ...ENV, GITHUB_APP_SLUG: undefined }
    )
    expect(await noSlug.json()).toEqual({ error: 'not_installed' })
  })

  it('instalação sem o repo/permissão (422 no access_tokens) → 412, sem repassar o corpo', async () => {
    const gh = fakeGitHub({
      token: () => Response.json({ message: 'permissions not granted' }, { status: 422 })
    })
    const res = await run(VALID, gh)
    expect(res.status).toBe(412)
    expect(await res.text()).not.toContain('permissions not granted')
    expect(gh.calls).toHaveLength(4) // nada foi postado
  })

  it('422 do GitHub ao postar (linha fora do diff) → 400 com mensagem genérica', async () => {
    const gh = fakeGitHub({
      review: () =>
        Response.json({ message: 'pull_request_review_thread.line inválida' }, { status: 422 })
    })
    const res = await run(VALID, gh)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({
      error: 'bad_request',
      reason: 'rejected'
    })
    expect(body).not.toContain('inválida')
    expectNoSecrets(body)
  })

  it('PR inexistente → 400 pr_not_found; token do App recusado na PR → not_installed', async () => {
    const missing = await run(
      VALID,
      fakeGitHub({ review: () => new Response('', { status: 404 }) })
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'bad_request', reason: 'pr_not_found' })
    const denied = await run(VALID, fakeGitHub({ review: () => new Response('', { status: 403 }) }))
    expect(denied.status).toBe(412)
  })

  it('link da revisão estranho → 200 com url null (já postada: não repetir)', async () => {
    const gh = fakeGitHub({
      review: () => Response.json({ id: 1, html_url: 'https://evil.example/acme/orkio/pull/7' })
    })
    const res = await run(VALID, gh)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: null })
  })

  it('JWT recusado (App ID e chave não batem) → not_configured', async () => {
    const res = await run(
      VALID,
      fakeGitHub({ installation: () => new Response('', { status: 401 }) })
    )
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'not_configured' })
  })

  it('variáveis ausentes ou inválidas → 503 not_configured, sem rede', async () => {
    const gh = fakeGitHub()
    for (const env of [
      { ...ENV, GITHUB_APP_ID: undefined },
      { ...ENV, GITHUB_APP_PRIVATE_KEY: undefined },
      { ...ENV, GITHUB_APP_ID: 'abc' },
      { ...ENV, GITHUB_APP_PRIVATE_KEY: 'lixo' }
    ]) {
      const res = await run(VALID, gh, env)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'not_configured' })
    }
    expect(gh.calls).toHaveLength(0)
  })

  it('exige JSON e limita o corpo', async () => {
    const gh = fakeGitHub()
    const text = await handleReview(post(VALID, { 'content-type': 'text/plain' }), ENV, {
      fetch: gh.fetch
    })
    expect(text.status).toBe(415)
    const big = await run({ ...VALID, pad: 'x'.repeat(1024 * 1024) }, gh)
    expect(big.status).toBe(413)
    expect(gh.calls).toHaveLength(0)
  })

  it('GitHub fora do ar ou resposta estranha → 502 upstream', async () => {
    const down = vi.fn(async () => {
      throw new TypeError(`fetch failed ${USER_TOKEN}`)
    }) as unknown as typeof fetch
    const res = await handleReview(post(VALID), ENV, { fetch: down })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(USER_TOKEN)
    expect(
      (await run(VALID, fakeGitHub({ token: () => Response.json({ token: 'tem espaço' }) }))).status
    ).toBe(502)
    expect(
      (await run(VALID, fakeGitHub({ installation: () => new Response('', { status: 500 }) })))
        .status
    ).toBe(502)
    expect(
      (await run(VALID, fakeGitHub({ review: () => new Response('', { status: 500 }) }))).status
    ).toBe(502)
  })

  it('respostas de erro nunca trazem tokens, JWT nem chave', async () => {
    for (const gh of [
      fakeGitHub({ installation: () => new Response('', { status: 404 }) }),
      fakeGitHub({ installation: () => new Response('', { status: 401 }) }),
      fakeGitHub({ token: () => new Response('', { status: 422 }) }),
      fakeGitHub({ review: () => new Response('', { status: 500 }) }),
      fakeGitHub({ review: () => new Response('', { status: 403 }) }),
      fakeGitHub({ repo: () => new Response('', { status: 404 }) })
    ]) {
      const res = await run(VALID, gh)
      expect(res.status).not.toBe(200)
      expectNoSecrets(await res.text())
    }
  })

  it('prazo total: chamadas lentas somadas estouram → 502, mesmo cada uma dentro do limite', async () => {
    const gh = fakeGitHub()
    const slow = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 40))
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return gh.fetch(input, init)
    }) as unknown as typeof fetch
    const res = await handleReview(post(VALID), ENV, {
      fetch: slow,
      timeoutMs: 1_000,
      deadlineMs: 100
    })
    expect(res.status).toBe(502)
    expect(gh.calls.some((c) => c.url.endsWith('/reviews'))).toBe(false)
  })

  it('exceção inesperada no meio → 502 upstream genérico, sem log', async () => {
    const gh = fakeGitHub()
    const res = await handleReview(post(VALID), ENV, {
      fetch: gh.fetch,
      now: () => {
        throw new Error(`quebrou com ${APP_TOKEN}`)
      }
    })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream' })
  })

  it('timeout vale também durante a leitura do corpo da resposta', async () => {
    const hanging = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"name":'))
              // nunca fecha
            }
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch
    const started = Date.now()
    const res = await handleReview(post(VALID), ENV, { fetch: hanging, timeoutMs: 50 })
    expect(res.status).toBe(502)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(hanging).toHaveBeenCalledTimes(1)
  })

  it('a rota aplica o limitador por IP antes de qualquer coisa', async () => {
    const upstream = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', upstream)
    const res = await reviewPost(post(VALID), createRateLimiter({ limit: 0, windowMs: 60_000 }))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('link da revisão', () => {
  it('só github.com/<o>/<r>/pull/<n> (sem diferenciar caixa) com âncora de revisão opcional', () => {
    expect(reviewUrlOrNull(REVIEW_URL, 'acme', 'orkio', 7)).toBe(REVIEW_URL)
    expect(reviewUrlOrNull(REVIEW_URL, 'Acme', 'Orkio', 7)).toBe(REVIEW_URL)
    expect(reviewUrlOrNull(REVIEW_URL, 'acme', 'orkio', 8)).toBeNull()
    expect(
      reviewUrlOrNull('https://github.com/acme/orkio/pull/7?x=1', 'acme', 'orkio', 7)
    ).toBeNull()
    expect(reviewUrlOrNull('http://github.com/acme/orkio/pull/7', 'acme', 'orkio', 7)).toBeNull()
    expect(
      reviewUrlOrNull('https://github.com:8443/acme/orkio/pull/7', 'acme', 'orkio', 7)
    ).toBeNull()
    expect(
      reviewUrlOrNull('https://u:p@github.com/acme/orkio/pull/7', 'acme', 'orkio', 7)
    ).toBeNull()
    expect(reviewUrlOrNull(null, 'acme', 'orkio', 7)).toBeNull()
  })
})

describe('GITHUB_API_URL (só E2E local)', () => {
  it('só http://127.0.0.1 fora da Vercel', () => {
    const base = { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: '' }
    expect(apiBaseFrom({ ...base, GITHUB_API_URL: 'http://127.0.0.1:4010/x' })).toBe(
      'http://127.0.0.1:4010'
    )
    expect(apiBaseFrom({ ...base, GITHUB_API_URL: 'http://127.0.0.1:4010', VERCEL: '1' })).toBe(
      GITHUB_API_URL
    )
    expect(apiBaseFrom({ ...base, GITHUB_API_URL: 'https://evil.example' })).toBe(GITHUB_API_URL)
    expect(apiBaseFrom({ ...base, GITHUB_API_URL: 'http://localhost:1' })).toBe(GITHUB_API_URL)
    expect(apiBaseFrom({ ...base, GITHUB_API_URL: 'lixo' })).toBe(GITHUB_API_URL)
    expect(apiBaseFrom(base)).toBe(GITHUB_API_URL)
  })
})

describe('POST /github/installation', () => {
  const ask = (body: unknown, gh = fakeGitHub(), env: GitHubAppEnv = ENV): Promise<Response> =>
    handleInstallation(post(body), env, { fetch: gh.fetch, now: () => NOW })
  const QUERY = { owner: 'Acme', repo: 'orkio', userToken: USER_TOKEN }

  it('instalado: confere o repo com o token do usuário e consulta a instalação com o JWT', async () => {
    const gh = fakeGitHub()
    const res = await ask(QUERY, gh)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({
      installed: true,
      installUrl: 'https://github.com/apps/orkio/installations/new'
    })
    expectNoSecrets(text)
    expect(gh.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/repos/Acme/orkio',
      '/repos/acme/orkio/installation'
    ])
    expect(gh.calls[0]!.auth).toBe(`Bearer ${USER_TOKEN}`)
    expect(gh.calls[1]!.auth.startsWith('Bearer eyJ')).toBe(true)
    // Só leitura: nenhum token de instalação, nenhum POST.
    expect(gh.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('não instalado → 200 com installed false e o link', async () => {
    const gh = fakeGitHub({ installation: () => Response.json({}, { status: 404 }) })
    const res = await ask(QUERY, gh)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      installed: false,
      installUrl: 'https://github.com/apps/orkio/installations/new'
    })
  })

  it('repositório invisível para o token → forbidden, sem perguntar ao App', async () => {
    for (const status of [401, 403, 404]) {
      const gh = fakeGitHub({ repo: () => Response.json({}, { status }) })
      const res = await ask(QUERY, gh)
      expect(res.status).toBe(403)
      expect(gh.calls).toHaveLength(1)
    }
  })

  it('pedido inválido → 400 sem rede; sem chave → 503', async () => {
    const gh = fakeGitHub()
    for (const bad of [
      {},
      { ...QUERY, owner: 'a/b' },
      { ...QUERY, repo: '..' },
      { ...QUERY, userToken: 'tem espaço' }
    ]) {
      expect((await ask(bad, gh)).status).toBe(400)
    }
    expect(gh.calls).toHaveLength(0)
    const res = await ask(QUERY, gh, { ...ENV, GITHUB_APP_PRIVATE_KEY: undefined })
    expect(res.status).toBe(503)
  })

  it('JWT recusado → not_configured; falha de rede → upstream', async () => {
    const gh = fakeGitHub({ installation: () => Response.json({}, { status: 401 }) })
    expect((await ask(QUERY, gh)).status).toBe(503)
    const down = {
      fetch: vi.fn(async () => Promise.reject(new Error('rede'))) as unknown as typeof fetch
    }
    const res = await handleInstallation(post(QUERY), ENV, { ...down, now: () => NOW })
    expect(res.status).toBe(502)
  })
})

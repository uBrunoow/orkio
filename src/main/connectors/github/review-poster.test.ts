import { describe, expect, it, vi } from 'vitest'
import { GitHubApiError, type ConditionalPage } from './github.client'
import type { OrkioSiteResponse, OrkioSiteReviewPayload } from './github.connector'
import {
  GitHubReviewPoster,
  REVIEW_MESSAGES,
  ReviewPostError,
  checkCommentsAgainstDiff,
  prepareReview,
  rightSideLines,
  type ReviewGitHub,
  type ReviewInput
} from './review-poster'

const REVIEW_URL = 'https://github.com/acme/orkio/pull/7#pullrequestreview-99'

/** Patch com as linhas 10 (contexto), 11 (nova), 12 (contexto) no lado novo. */
const PATCH = '@@ -10,3 +10,3 @@ function x() {\n ctx\n-old\n+new\n ctx2'

function fakeGitHub(
  opts: {
    site?: (payload: OrkioSiteReviewPayload) => OrkioSiteResponse | Promise<OrkioSiteResponse>
    files?: unknown[][]
    configured?: boolean
  } = {}
) {
  const sent: { payload: OrkioSiteReviewPayload }[] = []
  const paths: string[] = []
  const pages = opts.files ?? [[{ filename: 'src/a.ts', patch: PATCH }]]
  const github: ReviewGitHub = {
    hasOrkioSite: () => opts.configured ?? true,
    postReviewViaOrkioSite: vi.fn(async (payload: OrkioSiteReviewPayload) => {
      sent.push({ payload })
      return opts.site ? opts.site(payload) : { status: 200, body: { url: REVIEW_URL } }
    }),
    getConditional: vi.fn(async (path: string): Promise<ConditionalPage> => {
      paths.push(path)
      const index = paths.length - 1
      return {
        notModified: false,
        body: pages[index] ?? [],
        etag: null,
        nextPath:
          index + 1 < pages.length ? `/repos/acme/orkio/pulls/7/files?page=${index + 2}` : null
      }
    })
  }
  return { github, sent, paths }
}

function poster(gh = fakeGitHub()) {
  return new GitHubReviewPoster({ github: gh.github })
}

const REVIEW: ReviewInput = {
  event: 'REQUEST_CHANGES',
  body: 'Faltam testes.',
  comments: [{ path: 'src/a.ts', line: 11, body: 'Trate o erro aqui.' }]
}

async function rejection(p: Promise<unknown>): Promise<ReviewPostError> {
  const error = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ReviewPostError)
  return error as ReviewPostError
}

describe('GitHubReviewPoster.postReview', () => {
  it('confere o diff e manda a revisão ao site pelo conector; devolve só o link', async () => {
    const gh = fakeGitHub()
    expect(await poster(gh).postReview('acme', 'orkio', 7, REVIEW)).toEqual({ url: REVIEW_URL })
    expect(gh.paths).toEqual(['/repos/acme/orkio/pulls/7/files?per_page=100'])
    expect(gh.sent).toEqual([
      {
        payload: {
          owner: 'acme',
          repo: 'orkio',
          number: 7,
          review: {
            event: 'REQUEST_CHANGES',
            body: 'Faltam testes.',
            comments: [{ path: 'src/a.ts', line: 11, side: 'RIGHT', body: 'Trate o erro aqui.' }]
          }
        }
      }
    ])
  })

  it('sem comentários de linha não lê o diff', async () => {
    const gh = fakeGitHub()
    await poster(gh).postReview('acme', 'orkio', 7, { ...REVIEW, comments: [] })
    expect(gh.paths).toEqual([])
    expect(gh.sent).toHaveLength(1)
  })

  it('APPROVE (ou qualquer outro evento) é recusado antes de qualquer rede', async () => {
    const gh = fakeGitHub()
    for (const event of ['APPROVE', 'approve', 'DISMISS', undefined]) {
      const error = await rejection(
        poster(gh).postReview('acme', 'orkio', 7, { ...REVIEW, event } as unknown as ReviewInput)
      )
      expect(error.code).toBe('invalid')
      expect(error.message).toBe(REVIEW_MESSAGES.approveRefused)
    }
    expect(gh.sent).toHaveLength(0)
    expect(gh.paths).toHaveLength(0)
  })

  it('owner/repo/número inválidos são recusados sem rede', async () => {
    const gh = fakeGitHub()
    const bad: [string, string, number][] = [
      ['../acme', 'orkio', 7],
      ['acme', 'orkio/../x', 7],
      ['acme', '..', 7],
      ['-acme', 'orkio', 7],
      ['acme', 'or kio', 7],
      ['acme', 'orkio', 0],
      ['acme', 'orkio', -1],
      ['acme', 'orkio', 1.5],
      ['acme', 'orkio', 2 ** 31 + 1],
      ['acme', 'orkio', Number.NaN]
    ]
    for (const [o, r, n] of bad) {
      expect((await rejection(poster(gh).postReview(o, r, n, REVIEW))).code).toBe('invalid')
    }
    expect(gh.sent).toHaveLength(0)
    // "_" no owner (contas gerenciadas) é aceito.
    await poster(gh).postReview('ana_acme', 'orkio', 7, { ...REVIEW, comments: [] })
    expect(gh.sent).toHaveLength(1)
  })

  it('comentário fora do diff (linha removida, arquivo fora da PR, sem patch) → invalid sem postar', async () => {
    const gh = fakeGitHub({
      files: [
        [{ filename: 'src/a.ts', patch: PATCH }],
        [{ filename: 'img.png' }] // segunda página: binário sem patch
      ]
    })
    for (const c of [
      { path: 'src/a.ts', line: 13 },
      { path: 'src/b.ts', line: 11 },
      { path: 'img.png', line: 1 }
    ]) {
      const error = await rejection(
        poster(gh).postReview('acme', 'orkio', 7, {
          ...REVIEW,
          comments: [{ ...c, body: 'x' }]
        })
      )
      expect(error.code).toBe('invalid')
      expect(error.message).toContain(`${c.path}:${c.line}`)
    }
    expect(gh.sent).toHaveLength(0)
    expect(gh.paths).toContain('/repos/acme/orkio/pulls/7/files?page=2') // seguiu a paginação
  })

  it('resumo e comentários passam por redactSecrets antes de sair', async () => {
    const gh = fakeGitHub()
    const leaked = 'ghp_' + 'A'.repeat(30)
    await poster(gh).postReview('acme', 'orkio', 7, {
      event: 'COMMENT',
      body: `Achei API_KEY=abc123 e ${leaked}`,
      comments: [{ path: 'src/a.ts', line: 10, body: `token ${leaked}` }]
    })
    const sent = JSON.stringify(gh.sent)
    expect(sent).not.toContain(leaked)
    expect(sent).not.toContain('abc123')
    expect(sent).toContain('[segredo omitido]')
  })

  it('sem endereço do site no build → no_site (problema do app, não do site), sem rede', async () => {
    const gh = fakeGitHub({ configured: false })
    const p = poster(gh)
    expect(p.isConfigured()).toBe(false)
    const error = await rejection(p.postReview('acme', 'orkio', 7, REVIEW))
    expect(error.code).toBe('no_site')
    expect(error.message).toBe(
      'Este app não sabe o endereço do site do Orkio (MAIN_VITE_SITE_URL não definido no build). ' +
        'Em dev, defina em .env.development e reinicie o pnpm dev.'
    )
    expect(gh.sent).toHaveLength(0)
    expect(gh.paths).toHaveLength(0)
  })
})

describe('prepareReview', () => {
  it('comentários: caminho relativo, linha positiva, texto; limites de tamanho e quantidade', () => {
    const base = { event: 'COMMENT', body: 'ok' }
    const badComments = [
      { path: '/etc/passwd', line: 1, body: 'x' },
      { path: 'a/../b', line: 1, body: 'x' },
      { path: 'a\\b', line: 1, body: 'x' },
      { path: 'a\u0000b', line: 1, body: 'x' },
      { path: '', line: 1, body: 'x' },
      { path: 'p'.repeat(1001), line: 1, body: 'x' },
      { path: 'a.ts', line: 0, body: 'x' },
      { path: 'a.ts', line: 1.2, body: 'x' },
      { path: 'a.ts', line: 1, body: '   ' },
      { path: 'a.ts', line: 1, body: 'x'.repeat(4001) }
    ]
    for (const c of badComments) {
      expect(() => prepareReview({ ...base, comments: [c] }), JSON.stringify(c)).toThrow(
        ReviewPostError
      )
    }
    const many = Array.from({ length: 51 }, (_, i) => ({ path: 'a.ts', line: i + 1, body: 'x' }))
    expect(() => prepareReview({ ...base, comments: many })).toThrow(
      REVIEW_MESSAGES.tooManyComments
    )
    expect(() => prepareReview({ ...base, body: 'x'.repeat(20_001) })).toThrow(
      REVIEW_MESSAGES.bodyTooLong
    )
    // O GitHub exige resumo nos dois eventos.
    for (const event of ['COMMENT', 'REQUEST_CHANGES']) {
      expect(() =>
        prepareReview({ event, body: ' ', comments: [{ path: 'a.ts', line: 1, body: 'x' }] })
      ).toThrow(REVIEW_MESSAGES.emptyBody)
    }
    expect(prepareReview({ event: 'COMMENT', body: ' ok ' })).toEqual({
      event: 'COMMENT',
      body: 'ok',
      comments: []
    })
  })
})

describe('prepareReview limpa o texto (Task 18)', () => {
  it('sem HTML nem imagens no resumo e nos comentários; links como texto', () => {
    const r = prepareReview({
      event: 'REQUEST_CHANGES',
      body: 'Ver ![x](https://evil.example/a.png) <img src="https://evil.example/b"> [doc](https://d.example)<!-- oculto -->',
      comments: [
        { path: 'a.ts', line: 1, body: '<details>oi</details> ![](https://evil.example/c)' }
      ]
    })
    expect(r.body).toBe('Ver [imagem: x]  [doc](https://d.example)')
    expect(r.comments[0]!.body).toBe('oi [imagem]')
    expect(JSON.stringify(r)).not.toContain('evil.example')
  })

  it('aplicar de novo dá o mesmo texto (o gate mostra o que o postReview manda)', () => {
    const inputs = [
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 !',
      '!ghp_abcdefghijklmnopqrstuvwxyz0123456789(https://evil.example/x)',
      'API_KEY=abc <b>negrito</b> ![a](b)'
    ]
    for (const body of inputs) {
      const once = prepareReview({ event: 'COMMENT', body })
      const twice = prepareReview({ event: 'COMMENT', body: once.body })
      expect(twice.body).toBe(once.body)
      expect(once.body).not.toContain('ghp_')
    }
  })
})

describe('diff da PR', () => {
  it('rightSideLines: adicionadas e contexto do lado novo, em vários hunks', () => {
    const patch = [
      '@@ -1,2 +1,3 @@',
      ' a',
      '+b',
      ' c',
      '@@ -20,3 +21,2 @@',
      ' x',
      '-y',
      '\\ No newline at end of file',
      ' z'
    ].join('\n')
    expect([...rightSideLines(patch)]).toEqual([1, 2, 3, 21, 22])
    expect(rightSideLines('').size).toBe(0)
  })

  it('checkCommentsAgainstDiff aceita linhas do diff', () => {
    const files = new Map([['src/a.ts', rightSideLines(PATCH)]])
    expect(() =>
      checkCommentsAgainstDiff([{ path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'x' }], files)
    ).not.toThrow()
  })
})

describe('erros em pt-BR', () => {
  const site = (status: number, body: unknown) => () => ({ status, body })

  it.each([
    [503, { error: 'not_configured' }, 'not_configured', REVIEW_MESSAGES.notConfigured],
    [404, null, 'not_configured', REVIEW_MESSAGES.notConfigured],
    [403, { error: 'forbidden' }, 'forbidden', REVIEW_MESSAGES.forbidden],
    [429, { error: 'rate_limited' }, 'rate_limited', REVIEW_MESSAGES.rateLimited],
    [400, { error: 'bad_request', reason: 'rejected' }, 'rejected', REVIEW_MESSAGES.rejected],
    [400, { error: 'bad_request', reason: 'pr_not_found' }, 'not_found', REVIEW_MESSAGES.notFound],
    [400, { error: 'bad_request' }, 'invalid', REVIEW_MESSAGES.badRequest],
    [502, { error: 'upstream' }, 'upstream', REVIEW_MESSAGES.upstream],
    [500, null, 'upstream', REVIEW_MESSAGES.upstream]
  ])('site %i %j → %s', async (status, body, code, message) => {
    const gh = fakeGitHub({ site: site(status, body) })
    const error = await rejection(poster(gh).postReview('acme', 'orkio', 7, REVIEW))
    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it('200 com link estranho (outro host, porta, usuário) → url null (já foi postada)', async () => {
    for (const url of [
      'https://evil.example/acme/orkio/pull/7',
      'https://github.com:8443/acme/orkio/pull/7',
      'https://u:p@github.com/acme/orkio/pull/7',
      'https://github.com/acme/orkio/pull/8'
    ]) {
      const gh = fakeGitHub({ site: site(200, { url }) })
      expect(await poster(gh).postReview('acme', 'orkio', 7, REVIEW)).toEqual({ url: null })
    }
  })

  it('não instalado: link de instalação validado', async () => {
    const ok = fakeGitHub({
      site: site(412, {
        error: 'not_installed',
        installUrl: 'https://github.com/apps/orkio/installations/new'
      })
    })
    const error = await rejection(poster(ok).postReview('acme', 'orkio', 7, REVIEW))
    expect(error.code).toBe('not_installed')
    expect(error.message).toBe(REVIEW_MESSAGES.notInstalled)
    expect(error.details).toEqual({ installUrl: 'https://github.com/apps/orkio/installations/new' })

    const evil = fakeGitHub({
      site: site(412, { error: 'not_installed', installUrl: 'https://evil.example/apps/x' })
    })
    expect((await rejection(poster(evil).postReview('acme', 'orkio', 7, REVIEW))).details).toEqual(
      {}
    )
  })

  it.each([
    ['not_connected', 'not_connected'],
    ['network', 'site_network'],
    ['timeout', 'site_timeout'],
    ['server', 'upstream']
  ] as const)('erro %s do conector → %s, com a mensagem segura', async (from, to) => {
    const gh = fakeGitHub({
      site: () => {
        throw new GitHubApiError(from, `mensagem ${from}`, from === 'server' ? 500 : undefined)
      }
    })
    const error = await rejection(
      poster(gh).postReview('acme', 'orkio', 7, { ...REVIEW, comments: [] })
    )
    expect(error.code).toBe(to)
  })

  it('conector sem origem (ou origem recusada) → no_site, não "site sem App"', async () => {
    const gh = fakeGitHub({
      site: () => {
        throw new GitHubApiError('not_configured', 'Este app não sabe o endereço do site…')
      }
    })
    const error = await rejection(
      poster(gh).postReview('acme', 'orkio', 7, { ...REVIEW, comments: [] })
    )
    expect(error.code).toBe('no_site')
    expect(error.message).toBe(REVIEW_MESSAGES.noSite)
  })

  it('o site respondeu not_configured (503) → not_configured com a mensagem do site', async () => {
    const gh = fakeGitHub({ site: () => ({ status: 503, body: { error: 'not_configured' } }) })
    const error = await rejection(
      poster(gh).postReview('acme', 'orkio', 7, { ...REVIEW, comments: [] })
    )
    expect(error.code).toBe('not_configured')
    expect(error.message).toBe(REVIEW_MESSAGES.notConfigured)
    expect(error.message).not.toBe(REVIEW_MESSAGES.noSite)
  })

  it('nenhuma mensagem de erro carrega o corpo da resposta do site', async () => {
    const gh = fakeGitHub({
      site: site(403, { error: 'forbidden', detail: 'gho_SEGREDO_DO_USUARIO' })
    })
    const error = await rejection(poster(gh).postReview('acme', 'orkio', 7, REVIEW))
    expect(JSON.stringify({ m: error.message, d: error.details })).not.toContain('gho_')
  })
})

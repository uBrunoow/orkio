import { describe, expect, it, vi } from 'vitest'
import { GH_MESSAGES, GhCli, parseGhHttp, type GhExec } from './gh-cli'

const http = (status: string, headers: string[], body: string): string =>
  [`HTTP/2.0 ${status}`, ...headers, '', body].join('\r\n')

function cli(reply: (args: readonly string[], input?: string) => Awaited<ReturnType<GhExec>>): {
  gh: GhCli
  exec: ReturnType<typeof vi.fn>
} {
  const exec = vi.fn(async (args: readonly string[], input?: string) => reply(args, input))
  return { gh: new GhCli({ exec }), exec }
}

describe('GhCli: GitHub pelo gh do usuário', () => {
  it('lê o status, os cabeçalhos e o corpo do gh api -i', () => {
    const parsed = parseGhHttp(
      http('200 OK', ['Etag: "abc"', 'Link: <https://api.github.com/x?page=2>; rel="next"'], '[1]')
    )
    expect(parsed?.status).toBe(200)
    expect(parsed?.headers.get('etag')).toBe('"abc"')
    expect(parsed?.body).toBe('[1]')
    expect(parseGhHttp('sem cabeçalho')).toBeNull()
  })

  it('GET condicional: ETag no If-None-Match, 304 = sem mudança, próxima página pelo Link', async () => {
    const { gh, exec } = cli((args) =>
      args.includes('If-None-Match: "v1"')
        ? { code: 1, stdout: http('304 Not Modified', [], ''), stderr: '' }
        : {
            code: 0,
            stdout: http(
              '200 OK',
              [
                'ETag: "v1"',
                'Link: <https://api.github.com/repositories/9/pulls?page=2>; rel="next"'
              ],
              '[{"number":1}]'
            ),
            stderr: ''
          }
    )
    expect(await gh.getConditional('/repos/acme/app/pulls?state=open', null)).toEqual({
      notModified: false,
      body: [{ number: 1 }],
      etag: '"v1"',
      nextPath: '/repositories/9/pulls?page=2'
    })
    expect(exec.mock.calls[0]![0]).toEqual([
      'api',
      '--hostname',
      'github.com',
      '-i',
      '/repos/acme/app/pulls?state=open'
    ])
    expect(await gh.getConditional('/repos/acme/app/pulls?state=open', '"v1"')).toEqual({
      notModified: true
    })
  })

  it('só caminhos do repositório; nada que pareça opção vira argumento', async () => {
    const { gh, exec } = cli(() => ({ code: 0, stdout: http('200 OK', [], '{}'), stderr: '' }))
    await expect(gh.getConditional('/user', null)).rejects.toMatchObject({ code: 'unexpected' })
    await expect(gh.getConditional('/repos/a/b --method DELETE', null)).rejects.toMatchObject({
      code: 'unexpected'
    })
    expect(exec).not.toHaveBeenCalled()
  })

  it('erros: 404 sem acesso, SSO com o link, gh ausente e gh sem login', async () => {
    const notFound = cli(() => ({
      code: 1,
      stdout: http('404 Not Found', [], '{"message":"Not Found"}'),
      stderr: ''
    }))
    await expect(notFound.gh.getConditional('/repos/acme/app/pulls', null)).rejects.toMatchObject({
      code: 'not_found'
    })
    const sso = cli(() => ({
      code: 1,
      stdout: http(
        '403 Forbidden',
        ['X-Github-Sso: required; url=https://github.com/orgs/acme/sso?authorization_request=1'],
        '{}'
      ),
      stderr: ''
    }))
    await expect(sso.gh.getConditional('/repos/acme/app/pulls', null)).rejects.toMatchObject({
      code: 'sso_required'
    })
    const missing = cli(() => ({ code: null, stdout: '', stderr: '', missing: true }))
    await expect(missing.gh.getConditional('/repos/acme/app/pulls', null)).rejects.toMatchObject({
      code: 'not_connected',
      message: GH_MESSAGES.missing
    })
    const out = cli(() => ({
      code: 4,
      stdout: '',
      stderr: 'To get started with GitHub CLI, please run:  gh auth login'
    }))
    await expect(out.gh.getConditional('/repos/acme/app/pulls', null)).rejects.toMatchObject({
      code: 'not_connected',
      message: GH_MESSAGES.loggedOut
    })
  })

  it('GraphQL: corpo pela entrada padrão; dados parciais com os erros por campo', async () => {
    const { gh, exec } = cli(() => ({
      code: 0,
      stdout: http(
        '200 OK',
        [],
        JSON.stringify({ data: { repository: {} }, errors: [{ type: 'FORBIDDEN', path: ['x'] }] })
      ),
      stderr: ''
    }))
    expect(await gh.graphql('query { x }', { n: 1 })).toEqual({
      data: { repository: {} },
      errors: [{ type: 'FORBIDDEN', path: ['x'] }]
    })
    expect(exec.mock.calls[0]![0]).toEqual([
      'api',
      '--hostname',
      'github.com',
      '-i',
      'graphql',
      '--input',
      '-'
    ])
    expect(JSON.parse(exec.mock.calls[0]![1] as string)).toEqual({
      query: 'query { x }',
      variables: { n: 1 }
    })
  })

  it('status: login do gh (em cache), ou o motivo', async () => {
    const { gh, exec } = cli(() => ({ code: 0, stdout: 'ana\n', stderr: '' }))
    expect(await gh.status()).toEqual({ ok: true, login: 'ana' })
    expect(await gh.status()).toEqual({ ok: true, login: 'ana' })
    expect(exec).toHaveBeenCalledTimes(1)
    const missing = cli(() => ({ code: null, stdout: '', stderr: '', missing: true }))
    expect(await missing.gh.status()).toEqual({
      ok: false,
      code: 'missing',
      message: GH_MESSAGES.missing
    })
  })

  it('pedir revisores e postar a revisão: POST no próprio repositório com o corpo validado', async () => {
    const { gh, exec } = cli((args) =>
      args.includes('/repos/acme/app/pulls/7/reviews')
        ? {
            code: 0,
            stdout: http(
              '200 OK',
              [],
              '{"id":5,"html_url":"https://github.com/acme/app/pull/7#pullrequestreview-5"}'
            ),
            stderr: ''
          }
        : { code: 0, stdout: http('201 Created', [], '{}'), stderr: '' }
    )
    await gh.requestReviewers('acme', 'app', 7, { users: ['bia'], teams: [] })
    expect(exec.mock.calls[0]![0]).toContain('/repos/acme/app/pulls/7/requested_reviewers')
    expect(JSON.parse(exec.mock.calls[0]![1] as string)).toEqual({
      reviewers: ['bia'],
      team_reviewers: []
    })
    await expect(
      gh.requestReviewers('acme', 'app', 7, { users: ['-x'], teams: [] })
    ).rejects.toMatchObject({ code: 'unexpected' })
    const posted = await gh.postReview('acme', 'app', 7, {
      event: 'COMMENT',
      body: 'ok',
      comments: [{ path: 'a.ts', line: 3, body: 'aqui' }]
    })
    expect(posted).toEqual({ url: 'https://github.com/acme/app/pull/7#pullrequestreview-5' })
    expect(JSON.parse(exec.mock.calls.at(-1)![1] as string)).toEqual({
      event: 'COMMENT',
      body: 'ok',
      comments: [{ path: 'a.ts', line: 3, side: 'RIGHT', body: 'aqui' }]
    })
  })
})

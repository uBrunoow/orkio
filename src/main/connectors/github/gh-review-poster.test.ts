import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../net/http'
import type { GhCli } from './gh-cli'
import { GhReviewPoster } from './gh-review-poster'
import { ReviewPostError } from './review-poster'

const pr = (login: string) => ({
  notModified: false as const,
  body: { user: { login } },
  etag: null,
  nextPath: null
})
const files = {
  notModified: false as const,
  body: [{ filename: 'src/a.ts', patch: '@@ -1,1 +1,3 @@\n a\n+b\n+c' }],
  etag: null,
  nextPath: null
}

function fakeGh(over: Partial<Record<'login' | 'author', string>> = {}) {
  const postReview = vi.fn(async () => ({
    url: 'https://github.com/acme/app/pull/7#pullrequestreview-9'
  }))
  const gh = {
    status: vi.fn(async () => ({ ok: true as const, login: over.login ?? 'ana' })),
    getConditional: vi.fn(async (path: string) =>
      path.endsWith('/files?per_page=100') ? files : pr(over.author ?? 'ana')
    ),
    postReview
  }
  return { gh: gh as unknown as GhCli, postReview }
}

describe('GhReviewPoster: revisão pelo gh do usuário', () => {
  it('quem publica é o login do gh; autor da PR é reconhecido (sem diferenciar maiúsculas)', async () => {
    expect(await new GhReviewPoster(fakeGh({ author: 'ANA' }).gh).who('acme', 'app', 7)).toEqual({
      login: 'ana',
      author: true
    })
    expect(await new GhReviewPoster(fakeGh({ author: 'bia' }).gh).who('acme', 'app', 7)).toEqual({
      login: 'ana',
      author: false
    })
  })

  it('valida e confere os comentários contra o diff antes de postar; nunca APPROVE', async () => {
    const { gh, postReview } = fakeGh()
    const poster = new GhReviewPoster(gh)
    expect(
      await poster.postReview('acme', 'app', 7, {
        event: 'COMMENT',
        body: 'ok',
        comments: [{ path: 'src/a.ts', line: 3, body: 'aqui' }]
      })
    ).toEqual({ url: 'https://github.com/acme/app/pull/7#pullrequestreview-9' })
    expect(postReview).toHaveBeenCalledWith('acme', 'app', 7, {
      event: 'COMMENT',
      body: 'ok',
      comments: [{ path: 'src/a.ts', line: 3, body: 'aqui' }]
    })
    await expect(
      poster.postReview('acme', 'app', 7, {
        event: 'COMMENT',
        body: 'ok',
        comments: [{ path: 'src/a.ts', line: 30, body: 'fora' }]
      })
    ).rejects.toBeInstanceOf(ReviewPostError)
    await expect(
      poster.postReview('acme', 'app', 7, { event: 'APPROVE' as never, body: 'ok', comments: [] })
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('erros do gh viram ReviewPostError com a mensagem dele', async () => {
    const { gh } = fakeGh()
    ;(gh.postReview as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('github', 'not_connected', 'Entre no GitHub CLI: rode gh auth login.')
    )
    await expect(
      new GhReviewPoster(gh).postReview('acme', 'app', 7, {
        event: 'COMMENT',
        body: 'x',
        comments: []
      })
    ).rejects.toMatchObject({
      code: 'not_connected',
      message: 'Entre no GitHub CLI: rode gh auth login.'
    })
  })
})

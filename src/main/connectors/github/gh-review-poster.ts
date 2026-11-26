/**
 * Revisão publicada pelo `gh` do usuário (projeto só com git local): mesma validação, redação e
 * conferência contra o diff do `GitHubReviewPoster` (site/orkio[bot]), mas o POST vai pelo `gh`
 * e a revisão aparece com o usuário dele. O autor da PR só pode comentar (quem chama decide).
 */
import { isApiError } from '../../net/http'
import type { GhCli } from './gh-cli'
import {
  GitHubReviewPoster,
  REVIEW_MESSAGES,
  ReviewPostError,
  checkCommentsAgainstDiff,
  prepareReview,
  type PostedReview,
  type ReviewInput
} from './review-poster'

export class GhReviewPoster {
  /** Só para ler o diff da PR (mesma regra das linhas comentáveis), pelo `gh`. */
  private readonly reader: GitHubReviewPoster

  constructor(private readonly gh: Pick<GhCli, 'status' | 'getConditional' | 'postReview'>) {
    this.reader = new GitHubReviewPoster({
      github: {
        getConditional: (path, etag) => gh.getConditional(path, etag),
        hasOrkioSite: () => false,
        postReviewViaOrkioSite: () => Promise.reject(new Error('não usado'))
      }
    })
  }

  /** Pelo `gh` não há site a configurar. */
  isConfigured(): boolean {
    return true
  }

  /** O login do `gh` e se ele é o autor da PR. */
  async who(
    owner: string,
    repo: string,
    number: number
  ): Promise<{ login: string; author: boolean }> {
    const status = await this.gh.status()
    if (!status.ok) throw new ReviewPostError('not_connected', status.message)
    const page = await this.call(() =>
      this.gh.getConditional(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
        null
      )
    )
    const body = page.notModified ? null : page.body
    const user = isRecord(body) && isRecord(body['user']) ? body['user']['login'] : null
    const author = typeof user === 'string' && user.toLowerCase() === status.login.toLowerCase()
    return { login: status.login, author }
  }

  diffLines(owner: string, repo: string, number: number): Promise<Map<string, Set<number>>> {
    return this.reader.diffLines(owner, repo, number)
  }

  async postReview(
    owner: string,
    repo: string,
    number: number,
    review: ReviewInput
  ): Promise<PostedReview> {
    const prepared = prepareReview(review)
    if (prepared.comments.length > 0) {
      checkCommentsAgainstDiff(prepared.comments, await this.diffLines(owner, repo, number))
    }
    return this.call(() =>
      this.gh.postReview(owner, repo, number, {
        event: prepared.event,
        body: prepared.body,
        comments: prepared.comments.map(({ path, line, body }) => ({ path, line, body }))
      })
    )
  }

  /** Erros do `gh` → `ReviewPostError` (as mensagens dele já são pt-BR, sem stderr cru). */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof ReviewPostError) throw error
      if (isApiError(error, 'github')) {
        switch (error.code) {
          case 'not_connected':
          case 'timeout':
          case 'rate_limited':
          case 'network':
            throw new ReviewPostError(error.code, error.message)
          case 'not_found':
            throw new ReviewPostError('not_found', REVIEW_MESSAGES.notFound)
          case 'invalid':
            throw new ReviewPostError('invalid', REVIEW_MESSAGES.rejected)
        }
      }
      throw new ReviewPostError('upstream', REVIEW_MESSAGES.upstream)
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

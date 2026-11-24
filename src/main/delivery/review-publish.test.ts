import { describe, expect, it, vi } from 'vitest'
import { PUBLISH_REVIEW_MESSAGES } from '../../shared/review-publish'
import type { ActionConfirm } from '../../shared/task-flow'
import { REVIEW_MESSAGES, ReviewPostError } from '../connectors/github/review-poster'
import { SIGNALS_FAILURE } from './action-helpers'
import {
  createPublishReviewAction,
  PUBLISH_ACTION_MESSAGES,
  PUBLISH_FAILURES,
  type PublishReviewDeps
} from './review-publish'
import { ApiError } from '../net/http'

const JSON_ANSWER = JSON.stringify({
  event: 'REQUEST_CHANGES',
  summary: 'Falta validar. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 vazou.',
  comments: [
    { path: 'src/a.ts', line: 3, body: 'Valide aqui.' },
    { path: 'src/a.ts', line: 90, body: 'Linha fora do diff.' }
  ]
})

const PR_OK = {
  ok: true as const,
  value: {
    signals: { t1: { pr: { number: 7, state: 'open', url: 'https://github.com/acme/app/pull/7' } } }
  } as never
}

function setup(over: Partial<PublishReviewDeps> = {}) {
  const events: Record<string, unknown>[] = []
  const posted: unknown[] = []
  const automation: string[] = []
  const deps: PublishReviewDeps = {
    poster: {
      isConfigured: () => true,
      diffLines: async () => new Map([['src/a.ts', new Set([1, 2, 3])]]),
      postReview: async (...args) => {
        posted.push(args)
        return { url: 'https://github.com/acme/app/pull/7#pullrequestreview-42' }
      }
    },
    finalText: async () => JSON_ANSWER,
    signals: async () => PR_OK,
    repo: () => ({ owner: 'acme', repo: 'app' }),
    store: { addEvent: (e) => void events.push(e as unknown as Record<string, unknown>) },
    runAutomation: (id) => void automation.push(id),
    now: () => new Date('2026-11-24T10:00:00Z'),
    ...over
  }
  const action = createPublishReviewAction(deps)
  const ctx = { projectId: 'p1', taskId: 't1', vars: {}, lastRunId: 'run-9' }
  return { action, ctx, events, posted, automation }
}

describe('publish_review: antes do gate', () => {
  it('monta o gate com o tipo, o resumo redigido, os comentários e os fora do diff', async () => {
    const finalText = vi.fn(async () => JSON_ANSWER)
    const { action, ctx } = setup({ finalText })
    const info = (await action.confirm!(ctx)) as ActionConfirm
    expect(finalText).toHaveBeenCalledWith('run-9')
    expect(info.title).toBe('Publicar a revisão na PR #7?')
    expect(info.approveLabel).toBe('Publicar revisão')
    expect(info.review?.event).toBe('REQUEST_CHANGES')
    expect(info.review?.summary).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(info.review?.comments.map((c) => c.inDiff)).toEqual([true, false])
    expect(info.review?.pr).toEqual({ owner: 'acme', repo: 'app', number: 7 })
    expect(info.details).toContainEqual({
      label: 'Comentários',
      value: '1 de linha (1 fora do diff)'
    })
    expect(info.link?.url).toBe('https://github.com/acme/app/pull/7')
    expect(info.warning).toBeUndefined()
  })

  it('sem comentários de linha não lê o diff', async () => {
    const diffLines = vi.fn(async () => new Map<string, Set<number>>())
    const { action, ctx } = setup({
      finalText: async () => JSON.stringify({ event: 'COMMENT', summary: 'Tudo certo.' }),
      poster: { isConfigured: () => true, diffLines, postReview: vi.fn() }
    })
    const info = (await action.confirm!(ctx)) as ActionConfirm
    expect(info.review).toMatchObject({ event: 'COMMENT', comments: [] })
    expect(diffLines).not.toHaveBeenCalled()
  })

  it('problemas viram falha do passo (nada é publicado)', async () => {
    const cases: [Partial<PublishReviewDeps>, string, string][] = [
      [
        { poster: { isConfigured: () => false, diffLines: vi.fn(), postReview: vi.fn() } },
        PUBLISH_FAILURES.noSite,
        PUBLISH_ACTION_MESSAGES.noSite
      ],
      [{ finalText: async () => null }, PUBLISH_FAILURES.invalid, PUBLISH_REVIEW_MESSAGES.noAnswer],
      [
        { finalText: async () => 'Revisei.' },
        PUBLISH_FAILURES.invalid,
        PUBLISH_REVIEW_MESSAGES.notJson
      ],
      [
        { finalText: async () => JSON.stringify({ event: 'APPROVE', summary: 'ok' }) },
        PUBLISH_FAILURES.invalid,
        PUBLISH_REVIEW_MESSAGES.badEvent
      ],
      [{ repo: () => null }, PUBLISH_FAILURES.noRepo, PUBLISH_ACTION_MESSAGES.noRepo],
      [
        { signals: async () => ({ ok: false, error: { code: 'x', message: 'x' } }) as never },
        SIGNALS_FAILURE.code,
        SIGNALS_FAILURE.message
      ],
      [
        { signals: async () => ({ ok: true, value: { signals: {} } }) as never },
        PUBLISH_FAILURES.noPr,
        PUBLISH_ACTION_MESSAGES.noPr
      ]
    ]
    for (const [over, code, message] of cases) {
      const { action, ctx, posted } = setup(over)
      expect(await action.confirm!(ctx)).toEqual({ problem: { code, message } })
      expect(posted).toEqual([])
    }
    // Sem execução no fluxo.
    const { action, ctx } = setup()
    expect(await action.confirm!({ ...ctx, lastRunId: null })).toEqual({
      problem: { code: PUBLISH_FAILURES.invalid, message: PUBLISH_REVIEW_MESSAGES.noAnswer }
    })
    // Caminho inválido (prepareReview) e erro ao ler o diff.
    const bad = setup({
      finalText: async () =>
        JSON.stringify({
          event: 'COMMENT',
          summary: 's',
          comments: [{ path: '../x', line: 1, body: 'b' }]
        })
    })
    expect(await bad.action.confirm!(bad.ctx)).toEqual({
      problem: {
        code: PUBLISH_FAILURES.invalid,
        message: `${PUBLISH_ACTION_MESSAGES.invalidPrefix} ${REVIEW_MESSAGES.badComment}`
      }
    })
    const diffFail = setup({
      poster: {
        isConfigured: () => true,
        diffLines: async () => {
          throw new ReviewPostError('not_found', REVIEW_MESSAGES.notFound)
        },
        postReview: vi.fn()
      }
    })
    expect(await diffFail.action.confirm!(diffFail.ctx)).toEqual({
      problem: { code: 'review_not_found', message: REVIEW_MESSAGES.notFound }
    })
  })
})

describe('publish_review: aprovar', () => {
  async function confirmed(over: Partial<PublishReviewDeps> = {}) {
    const s = setup(over)
    const info = (await s.action.confirm!(s.ctx)) as ActionConfirm
    return { ...s, info }
  }

  it('posta só os comentários do diff, registra o histórico com o link e roda as automações', async () => {
    const { action, ctx, info, posted, events, automation } = await confirmed()
    const r = await action.run({ ...ctx, confirmed: info })
    expect(r).toEqual({
      ok: true
    })
    expect(posted).toEqual([
      [
        'acme',
        'app',
        7,
        {
          event: 'REQUEST_CHANGES',
          body: info.review!.summary,
          comments: [{ path: 'src/a.ts', line: 3, body: 'Valide aqui.' }]
        }
      ]
    ])
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'delivery',
        taskPageId: 't1',
        detail: {
          by: 'orkio',
          action: 'review_post',
          owner: 'acme',
          repo: 'app',
          reviewEvent: 'REQUEST_CHANGES',
          comments: 1,
          pr: { number: 7, owner: 'acme', repo: 'app' },
          reviewId: 42
        }
      })
    ])
    expect(automation).toEqual(['p1'])
  })

  it('o gate guarda o texto limpo (sem HTML/imagens) e é exatamente esse texto que vai', async () => {
    const answer = JSON.stringify({
      event: 'COMMENT',
      summary:
        'Resumo <img src="https://evil.example/x"> ![g](https://evil.example/y) [ok](https://d.example)',
      comments: [{ path: 'src/a.ts', line: 3, body: '<!-- oculto -->Valide.' }]
    })
    const { action, ctx, info, posted } = await confirmed({ finalText: async () => answer })
    expect(info.review?.summary).toBe('Resumo  [imagem: g] [ok](https://d.example)')
    expect(info.review?.comments[0]?.body).toBe('Valide.')
    await action.run({ ...ctx, confirmed: info })
    expect(posted).toEqual([
      [
        'acme',
        'app',
        7,
        {
          // Com comentário por linha, sai como "Pedir alterações" (parseReviewAnswer).
          event: 'REQUEST_CHANGES',
          body: 'Resumo  [imagem: g] [ok](https://d.example)',
          comments: [{ path: 'src/a.ts', line: 3, body: 'Valide.' }]
        }
      ]
    ])
  })

  it('sem confirmação guardada: não posta', async () => {
    const { action, ctx, posted } = setup()
    expect(await action.run(ctx)).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.noConfirm,
      message: PUBLISH_ACTION_MESSAGES.noConfirm
    })
    expect(posted).toEqual([])
  })

  it('erros do poster: não instalado traz o link; timeout avisa e o próximo gate também', async () => {
    let error: Error = new ReviewPostError('not_installed', REVIEW_MESSAGES.notInstalled, {
      installUrl: 'https://github.com/apps/orkio/installations/new'
    })
    const poster = {
      isConfigured: () => true,
      diffLines: async () => new Map([['src/a.ts', new Set([3])]]),
      postReview: async () => {
        throw error
      }
    }
    const { action, ctx, info, events } = await confirmed({ poster })
    const r1 = await action.run({ ...ctx, confirmed: info })
    expect(r1).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.notInstalled,
      message: `${REVIEW_MESSAGES.notInstalled} ${PUBLISH_ACTION_MESSAGES.installHint} https://github.com/apps/orkio/installations/new`
    })

    error = new ReviewPostError('app_not_configured', REVIEW_MESSAGES.notConfigured)
    expect(await action.run({ ...ctx, confirmed: info })).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.notConfigured,
      message: PUBLISH_ACTION_MESSAGES.notConfigured
    })

    // Build sem o endereço do site: mensagem do app (MAIN_VITE_SITE_URL), não "site sem App".
    error = new ReviewPostError('no_site', REVIEW_MESSAGES.noSite)
    expect(await action.run({ ...ctx, confirmed: info })).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.noSite,
      message: PUBLISH_ACTION_MESSAGES.noSite
    })

    // Decide pelo código do erro (`site_timeout`), não pelo texto da mensagem.
    error = new ReviewPostError('site_timeout', 'Qualquer texto do conector.')
    expect(await action.run({ ...ctx, confirmed: info })).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.maybePosted,
      message: 'Qualquer texto do conector.'
    })
    const again = (await action.confirm!(ctx)) as ActionConfirm
    expect(again.warning).toBe(PUBLISH_ACTION_MESSAGES.maybePosted)

    // Rede caiu no POST ao site: também pode ter publicado.
    error = new ReviewPostError('site_network', 'Sem conexão com o site.')
    const fresh = await confirmed({ poster })
    expect(await fresh.action.run({ ...fresh.ctx, confirmed: fresh.info })).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.maybePosted,
      message: PUBLISH_ACTION_MESSAGES.networkMaybePosted
    })
    expect(((await fresh.action.confirm!(fresh.ctx)) as ActionConfirm).warning).toBe(
      PUBLISH_ACTION_MESSAGES.maybePosted
    )
    // Rede ao ler o diff (antes de mandar): não conta.
    error = new ReviewPostError('network', 'Sem conexão com o GitHub.')
    const other = await confirmed({ poster })
    expect(await other.action.run({ ...other.ctx, confirmed: other.info })).toEqual({
      ok: false,
      code: 'review_network',
      message: 'Sem conexão com o GitHub.'
    })
    expect(((await other.action.confirm!(other.ctx)) as ActionConfirm).warning).toBeUndefined()

    // Erro inesperado: mensagem genérica (nunca a exceção crua).
    error = new ApiError('github', 'unexpected', 'segredo ghp_x')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await action.run({ ...ctx, confirmed: info })).toEqual({
      ok: false,
      code: PUBLISH_FAILURES.failed,
      message: PUBLISH_ACTION_MESSAGES.generic
    })
    expect(spy.mock.calls.flat().join(' ')).not.toContain('ghp_x')
    spy.mockRestore()
    expect(events).toEqual([])
  })
})

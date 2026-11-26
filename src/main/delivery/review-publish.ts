/**
 * Ação de fluxo `publish_review` (Task 18): publica na PR da tarefa, como `orkio[bot]`, a revisão
 * que o passo anterior (pedido em texto só leitura) escreveu em JSON.
 *
 * - **Antes do gate** (`confirm`): lê o texto final da execução mais recente do Claude Code deste
 *   fluxo (a mesma fonte do gate `show: 'result'`), valida o JSON, redige (`prepareReview`), acha a
 *   PR aberta e confere cada comentário de linha contra o diff da PR. O gate mostra o tipo, o
 *   resumo e os comentários; os que estão fora do diff aparecem como aviso e não são publicados.
 * - **Aprovar** (`run`): posta exatamente o que foi confirmado (menos os fora do diff) pelo
 *   `GitHubReviewPoster` (site do Orkio). Sem App configurado/instalado → o passo falha com a
 *   explicação (e o link de instalação); nada é postado.
 * - **Timeout ou queda de rede no POST ao site:** a revisão pode ter sido publicada. O passo falha dizendo isso, e "Retomar"
 *   passa de novo pelo gate (com o aviso), nunca reposta sozinho.
 *
 * Não é entrega (push/PR): o agente Revisor (`delivery: false`) pode rodar este passo.
 */
import { ORKIO_ACTIONS } from '../../shared/orkio-actions'
import { parseReviewAnswer } from '../../shared/review-publish'
import type { ActionConfirm, ConfirmReview, StepFailure } from '../../shared/task-flow'
import type { BoardStore } from '../board/board.store'
import {
  REVIEW_MESSAGES,
  ReviewPostError,
  prepareReview,
  type GitHubReviewPoster
} from '../connectors/github/review-poster'
import type { ActionResult, OrkioAction } from '../flows/flow-runner'
import { errorName } from '../errors'
import { deliveryEvent, openPullFor, type SignalsFetch } from './action-helpers'

import { GIT_ONLY_REVIEW_MESSAGE } from '../../shared/delivery'

/** Quem publica: o site (orkio[bot]) ou o `gh` do usuário (projeto só com git local). */
export type PublishPoster = Pick<
  GitHubReviewPoster,
  'isConfigured' | 'diffLines' | 'postReview'
> & {
  /** Pelo `gh`: o login que vai publicar e se ele é o autor da PR. Ausente = orkio[bot]. */
  who?(owner: string, repo: string, number: number): Promise<{ login: string; author: boolean }>
}

export interface PublishReviewDeps {
  poster: PublishPoster
  /** Projeto só com git local e o `gh` logado: publica pelo `gh` (com o usuário dele). */
  posterFor?(projectId: string): PublishPoster | null
  /**
   * Pelo `gh`, o autor da PR não pode pedir alterações nela: a revisão vai como comentário e
   * quem chama faz o que o "Alterações pedidas" faria (mover a tarefa para Revisado).
   */
  onSelfChangesRequested?(projectId: string, taskId: string): void
  /** Texto final de uma execução do Claude Code (log normalizado e redigido). */
  finalText(runId: string): Promise<string | null>
  signals: SignalsFetch
  /** Repositório do projeto no github.com (`null` = sem repositório ou outro host). */
  repo(projectId: string): { owner: string; repo: string } | null
  store: Pick<BoardStore, 'addEvent'>
  /** Depois de publicar: roda as automações já (REQUEST_CHANGES → "Alterações pedidas"). */
  runAutomation?(projectId: string): void
  /** Projeto só com git local sem o `gh` disponível: não dá para publicar. */
  gitOnly?(projectId: string): boolean | Promise<boolean>
  now?: () => Date
}

export const PUBLISH_ACTION_MESSAGES = {
  notConfigured:
    'Não dá para publicar a revisão como orkio[bot]: o GitHub App do Orkio ainda não está configurado no site do Orkio.',
  /** O build não tem o endereço do site (o site pode estar certo). */
  noSite: REVIEW_MESSAGES.noSite,
  noRepo:
    'O projeto não está ligado a um repositório do github.com: não há onde publicar a revisão.',
  noPr: 'Esta tarefa não tem PR aberta no GitHub: não há onde publicar a revisão.',
  invalidPrefix: 'A revisão em JSON é inválida:',
  noConfirm: 'A revisão não foi confirmada. Retome para ver a revisão e aprovar de novo.',
  generic: 'Não foi possível publicar a revisão. Tente de novo.',
  maybePosted:
    'A tentativa anterior demorou para responder: a revisão pode já estar na PR. Abra a PR e confira antes de publicar de novo.',
  installHint: 'Instale o App pelo link e retome.',
  selfAuthor:
    'Você é o autor da PR: o GitHub não deixa pedir alterações na própria PR. A revisão vai como comentário e o Orkio move a tarefa para Revisado.',
  networkMaybePosted:
    'A conexão com o site do Orkio caiu durante a publicação. Confira a PR antes de tentar de novo: a revisão pode ter sido publicada.'
} as const

/**
 * Códigos de falha do passo (a tela de problema reconhece os `review_*` que têm explicação
 * própria); os outros erros do `ReviewPostError` viram `review_<código>`.
 */
export const PUBLISH_FAILURES = {
  invalid: 'review_invalid',
  notInstalled: 'review_not_installed',
  notConfigured: 'review_not_configured',
  noSite: 'review_no_site',
  maybePosted: 'review_maybe_posted',
  noRepo: 'review_no_repo',
  gitOnly: 'review_git_only',
  noPr: 'review_no_pr',
  noConfirm: 'review_no_confirm',
  failed: 'review_failed'
} as const

const fail = (code: string, message: string): StepFailure => ({ code, message })

export function createPublishReviewAction(deps: PublishReviewDeps): OrkioAction {
  /** Tarefas cuja última tentativa estourou o prazo do site (só em memória; o passo registra). */
  const maybePosted = new Set<string>()

  function postFailure(error: ReviewPostError, taskId: string): StepFailure {
    switch (error.code) {
      // O pedido pode ter chegado ao site (e a revisão, saído): o próximo gate avisa.
      case 'site_timeout':
        maybePosted.add(taskId)
        return fail(PUBLISH_FAILURES.maybePosted, error.message)
      case 'site_network':
        maybePosted.add(taskId)
        return fail(PUBLISH_FAILURES.maybePosted, PUBLISH_ACTION_MESSAGES.networkMaybePosted)
      case 'not_installed': {
        const link = error.details.installUrl
        return link
          ? {
              code: PUBLISH_FAILURES.notInstalled,
              message: `${REVIEW_MESSAGES.notInstalled} ${PUBLISH_ACTION_MESSAGES.installHint}`,
              link
            }
          : fail(PUBLISH_FAILURES.notInstalled, REVIEW_MESSAGES.notInstalled)
      }
      case 'app_not_configured':
        return fail(PUBLISH_FAILURES.notConfigured, PUBLISH_ACTION_MESSAGES.notConfigured)
      case 'no_site':
        return fail(PUBLISH_FAILURES.noSite, PUBLISH_ACTION_MESSAGES.noSite)
      default:
        return fail(`review_${error.code}`, error.message)
    }
  }

  return {
    ...ORKIO_ACTIONS.publish_review,
    async confirm({ projectId, taskId, lastRunId }) {
      const poster = deps.posterFor?.(projectId) ?? deps.poster
      if (!poster.isConfigured()) {
        return { problem: fail(PUBLISH_FAILURES.noSite, PUBLISH_ACTION_MESSAGES.noSite) }
      }
      const text = lastRunId ? await deps.finalText(lastRunId) : null
      const parsed = parseReviewAnswer(text)
      if (!parsed.ok) return { problem: fail(PUBLISH_FAILURES.invalid, parsed.message) }
      let prepared
      try {
        prepared = prepareReview({
          event: parsed.review.event,
          body: parsed.review.summary,
          comments: parsed.review.comments
        })
      } catch (error) {
        if (error instanceof ReviewPostError) {
          return {
            problem: fail(
              PUBLISH_FAILURES.invalid,
              `${PUBLISH_ACTION_MESSAGES.invalidPrefix} ${error.message}`
            )
          }
        }
        throw error
      }
      if (await deps.gitOnly?.(projectId)) {
        return { problem: fail(PUBLISH_FAILURES.gitOnly, GIT_ONLY_REVIEW_MESSAGE) }
      }
      const target = deps.repo(projectId)
      if (!target) return { problem: fail(PUBLISH_FAILURES.noRepo, PUBLISH_ACTION_MESSAGES.noRepo) }
      const found = await openPullFor(deps.signals, projectId, taskId)
      if ('failure' in found) return { problem: found.failure }
      const pr = found.pr
      if (!pr) return { problem: fail(PUBLISH_FAILURES.noPr, PUBLISH_ACTION_MESSAGES.noPr) }
      let files: Map<string, Set<number>>
      try {
        files =
          prepared.comments.length > 0
            ? await poster.diffLines(target.owner, target.repo, pr.number)
            : new Map()
      } catch (error) {
        if (error instanceof ReviewPostError) return { problem: postFailure(error, taskId) }
        throw error
      }
      const review: ConfirmReview = {
        event: prepared.event,
        summary: prepared.body,
        comments: prepared.comments.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
          inDiff: files.get(c.path)?.has(c.line) ?? false
        })),
        pr: { owner: target.owner, repo: target.repo, number: pr.number }
      }
      const outside = review.comments.filter((c) => !c.inDiff).length
      const who = poster.who
        ? await poster.who(target.owner, target.repo, pr.number).catch(() => null)
        : null
      const selfAuthor = !!who?.author && prepared.event === 'REQUEST_CHANGES'
      const warnings = [
        ...(selfAuthor ? [PUBLISH_ACTION_MESSAGES.selfAuthor] : []),
        ...(maybePosted.has(taskId) ? [PUBLISH_ACTION_MESSAGES.maybePosted] : [])
      ]
      const info: ActionConfirm = {
        title: `Publicar a revisão na PR #${pr.number}?`,
        message: who
          ? `O Orkio vai publicar esta revisão na PR com o seu usuário do GitHub (@${who.login}, pelo gh). O Orkio nunca aprova PRs.`
          : 'O Orkio vai publicar esta revisão na PR como orkio[bot], pelo site do Orkio (com a sua conta do GitHub). O Orkio nunca aprova PRs.',
        details: [
          { label: 'PR', value: `#${pr.number}` },
          { label: 'Repositório', value: `${target.owner}/${target.repo}` },
          {
            label: 'Comentários',
            value: `${review.comments.length - outside} de linha${outside ? ` (${outside} fora do diff)` : ''}`
          }
        ],
        review,
        approveLabel: 'Publicar revisão',
        link: { label: `Abrir a PR #${pr.number} no GitHub`, url: pr.url },
        ...(warnings.length ? { warning: warnings.join(' ') } : {})
      }
      return info
    },
    async run({ projectId, taskId, confirmed }): Promise<ActionResult> {
      const r = confirmed?.review
      if (!r) {
        return { ok: false, ...fail(PUBLISH_FAILURES.noConfirm, PUBLISH_ACTION_MESSAGES.noConfirm) }
      }
      const comments = r.comments
        .filter((c) => c.inDiff)
        .map(({ path, line, body }) => ({ path, line, body }))
      const poster = deps.posterFor?.(projectId) ?? deps.poster
      // Pelo `gh`, o autor da PR só pode comentar (o GitHub recusa pedir alterações na própria PR).
      const who = poster.who
        ? await poster.who(r.pr.owner, r.pr.repo, r.pr.number).catch(() => null)
        : null
      const selfAuthor = !!who?.author && r.event === 'REQUEST_CHANGES'
      let url: string | null
      try {
        url = (
          await poster.postReview(r.pr.owner, r.pr.repo, r.pr.number, {
            event: selfAuthor ? 'COMMENT' : r.event,
            body: r.summary,
            comments
          })
        ).url
      } catch (error) {
        if (error instanceof ReviewPostError) return { ok: false, ...postFailure(error, taskId) }
        console.error(`[orkio] publicar revisão: ${errorName(error)}`)
        return { ok: false, ...fail(PUBLISH_FAILURES.failed, PUBLISH_ACTION_MESSAGES.generic) }
      }
      maybePosted.delete(taskId)
      const reviewId = url ? Number(/#pullrequestreview-(\d+)$/.exec(url)?.[1] ?? NaN) : NaN
      deliveryEvent(
        deps,
        { projectId, taskId },
        {
          action: 'review_post',
          owner: r.pr.owner,
          repo: r.pr.repo,
          reviewEvent: r.event,
          comments: comments.length,
          pr: { number: r.pr.number, owner: r.pr.owner, repo: r.pr.repo },
          ...(Number.isSafeInteger(reviewId) && reviewId > 0 ? { reviewId } : {})
        }
      )
      if (selfAuthor) deps.onSelfChangesRequested?.(projectId, taskId)
      deps.runAutomation?.(projectId)
      return { ok: true }
    }
  }
}

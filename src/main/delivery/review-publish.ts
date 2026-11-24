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
import { parseReviewAnswer } from '../../shared/review-publish'
import type { ActionConfirm, ConfirmReview } from '../../shared/task-flow'
import type { BoardStore } from '../board/board.store'
import {
  ORKIO_SITE_NETWORK_PREFIX,
  ORKIO_SITE_TIMEOUT_MESSAGE
} from '../connectors/github/github.connector'
import {
  REVIEW_MESSAGES,
  ReviewPostError,
  prepareReview,
  type GitHubReviewPoster
} from '../connectors/github/review-poster'
import type { OrkioAction } from '../flows/flow-runner'
import { errorName } from '../errors'
import type { Result } from '../../shared/result'
import type { TaskSignalsResult } from '../../shared/task-signals'

export interface PublishReviewDeps {
  poster: Pick<GitHubReviewPoster, 'isConfigured' | 'diffLines' | 'postReview'>
  /** Texto final de uma execução do Claude Code (log normalizado e redigido). */
  finalText(runId: string): Promise<string | null>
  signals(projectId: string, force: boolean): Promise<Result<TaskSignalsResult>>
  /** Repositório do projeto no github.com (`null` = sem repositório ou outro host). */
  repo(projectId: string): { owner: string; repo: string } | null
  store: Pick<BoardStore, 'addEvent'>
  /** Depois de publicar: roda as automações já (REQUEST_CHANGES → "Alterações pedidas"). */
  runAutomation?(projectId: string): void
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
  signals: 'Não deu para conferir a PR no GitHub agora. Tente de novo em instantes.',
  invalidPrefix: 'A revisão em JSON é inválida:',
  noConfirm: 'A revisão não foi confirmada. Retome para ver a revisão e aprovar de novo.',
  generic: 'Não foi possível publicar a revisão. Tente de novo.',
  maybePosted:
    'A tentativa anterior demorou para responder: a revisão pode já estar na PR. Abra a PR e confira antes de publicar de novo.',
  installHint: 'Instale o App neste link e retome:',
  networkMaybePosted:
    'A conexão com o site do Orkio caiu durante a publicação. Confira a PR antes de tentar de novo: a revisão pode ter sido publicada.'
} as const

export function createPublishReviewAction(deps: PublishReviewDeps): OrkioAction {
  /** Tarefas cuja última tentativa estourou o prazo do site (só em memória; o passo registra). */
  const maybePosted = new Set<string>()
  const now = (): string => (deps.now?.() ?? new Date()).toISOString()

  return {
    id: 'publish_review',
    label: 'Publicar revisão na PR (orkio[bot])',
    async confirm({ projectId, taskId, lastRunId }) {
      if (!deps.poster.isConfigured()) return { problem: PUBLISH_ACTION_MESSAGES.noSite }
      const text = lastRunId ? await deps.finalText(lastRunId) : null
      const parsed = parseReviewAnswer(text)
      if (!parsed.ok) return { problem: parsed.message }
      let prepared
      try {
        prepared = prepareReview({
          event: parsed.review.event,
          body: parsed.review.summary,
          comments: parsed.review.comments
        })
      } catch (error) {
        if (error instanceof ReviewPostError) {
          return { problem: `${PUBLISH_ACTION_MESSAGES.invalidPrefix} ${error.message}` }
        }
        throw error
      }
      const target = deps.repo(projectId)
      if (!target) return { problem: PUBLISH_ACTION_MESSAGES.noRepo }
      const r = await deps.signals(projectId, true)
      if (!r.ok) return { problem: PUBLISH_ACTION_MESSAGES.signals }
      const pr = r.value.signals[taskId]?.pr ?? null
      if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) {
        return { problem: PUBLISH_ACTION_MESSAGES.noPr }
      }
      let files: Map<string, Set<number>>
      try {
        files =
          prepared.comments.length > 0
            ? await deps.poster.diffLines(target.owner, target.repo, pr.number)
            : new Map()
      } catch (error) {
        if (error instanceof ReviewPostError) return { problem: error.message }
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
      const info: ActionConfirm = {
        title: `Publicar a revisão na PR #${pr.number}?`,
        message:
          'O Orkio vai publicar esta revisão na PR como orkio[bot], pelo site do Orkio (com a sua conta do GitHub). O Orkio nunca aprova PRs.',
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
        ...(maybePosted.has(taskId) ? { warning: PUBLISH_ACTION_MESSAGES.maybePosted } : {})
      }
      return info
    },
    async run({ projectId, taskId, confirmed }) {
      const r = confirmed?.review
      if (!r) return { ok: false, message: PUBLISH_ACTION_MESSAGES.noConfirm }
      const comments = r.comments
        .filter((c) => c.inDiff)
        .map(({ path, line, body }) => ({ path, line, body }))
      let url: string | null
      try {
        url = (
          await deps.poster.postReview(r.pr.owner, r.pr.repo, r.pr.number, {
            event: r.event,
            body: r.summary,
            comments
          })
        ).url
      } catch (error) {
        if (error instanceof ReviewPostError) {
          if (error.code === 'timeout' && error.message === ORKIO_SITE_TIMEOUT_MESSAGE) {
            maybePosted.add(taskId)
          }
          // Rede caiu no POST ao site: o pedido pode ter chegado (e a revisão, saído).
          if (error.code === 'network' && error.message.startsWith(ORKIO_SITE_NETWORK_PREFIX)) {
            maybePosted.add(taskId)
            return { ok: false, message: PUBLISH_ACTION_MESSAGES.networkMaybePosted }
          }
          if (error.code === 'not_installed') {
            const link = error.details.installUrl
            return {
              ok: false,
              message: link
                ? `${REVIEW_MESSAGES.notInstalled} ${PUBLISH_ACTION_MESSAGES.installHint} ${link}`
                : REVIEW_MESSAGES.notInstalled
            }
          }
          if (error.code === 'not_configured') {
            return { ok: false, message: PUBLISH_ACTION_MESSAGES.notConfigured }
          }
          if (error.code === 'no_site') {
            return { ok: false, message: PUBLISH_ACTION_MESSAGES.noSite }
          }
          return { ok: false, message: error.message }
        }
        console.error(`[orkio] publicar revisão: ${errorName(error)}`)
        return { ok: false, message: PUBLISH_ACTION_MESSAGES.generic }
      }
      maybePosted.delete(taskId)
      const reviewId = url ? Number(/#pullrequestreview-(\d+)$/.exec(url)?.[1] ?? NaN) : NaN
      deps.store.addEvent({
        taskPageId: taskId,
        projectId,
        at: now(),
        kind: 'delivery',
        source: 'manual',
        fromStage: null,
        toStage: null,
        detail: {
          by: 'orkio',
          action: 'review_post',
          owner: r.pr.owner,
          repo: r.pr.repo,
          reviewEvent: r.event,
          comments: comments.length,
          pr: { number: r.pr.number, owner: r.pr.owner, repo: r.pr.repo },
          ...(Number.isSafeInteger(reviewId) && reviewId > 0 ? { reviewId } : {})
        }
      })
      deps.runAutomation?.(projectId)
      return { ok: true, vars: { 'review.posted': 'sim', 'review.event': r.event } }
    }
  }
}

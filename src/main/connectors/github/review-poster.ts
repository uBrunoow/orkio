/**
 * Revisão publicada como `orkio[bot]` (GitHub App do Orkio).
 *
 * O app NUNCA tem o token do GitHub App: o token com `pull_requests: write` também permitiria
 * APPROVE. O app monta e valida a revisão (primeira barreira) e a manda ao site do Orkio
 * (`POST /github/review`) pelo conector do GitHub, que acrescenta o token OAuth do usuário; o site
 * confere o push, valida de novo (a garantia), posta com o App e devolve só o link.
 *
 * Validação local, antes de qualquer rede: `COMMENT` ou `REQUEST_CHANGES` (**APPROVE nunca**),
 * owner/repo/número, `redactSecrets` no resumo e nos comentários, limites de tamanho e, quando há
 * comentários de linha, conferência contra as linhas do diff da PR (lado novo).
 *
 * Erros viram `ReviewPostError` com mensagem pt-BR (nunca a exceção crua nem corpos de resposta).
 */
import { isOwner, isRepo } from '../../../shared/github-names'
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENTS_MAX,
  REVIEW_PATH_MAX,
  REVIEW_SUMMARY_MAX,
  sanitizeReviewText,
  type PublishReviewEvent
} from '../../../shared/review-publish'
import { redactSecrets } from '../../claude/redact'
import { isApiError } from '../../net/http'
import { isRecord } from '../../net/parse'
import type { ConditionalPage } from './github.client'
import {
  NO_SITE_MESSAGE,
  type OrkioSiteResponse,
  type OrkioSiteReviewPayload
} from './github.connector'
import { parseOrkioSiteResponse } from './orkio-site'
import { reviewUrlOrNull } from '../../../shared/site-contract'

/** Páginas de `GET /pulls/{n}/files` (100 por página; o GitHub para em 3000 arquivos). */
const PR_FILES_MAX_PAGES = 30

export interface ReviewComment {
  /** Caminho do arquivo no repositório (relativo, como no diff da PR). */
  path: string
  /** Linha no arquivo novo (lado direito do diff). */
  line: number
  body: string
}

export interface ReviewInput {
  event: PublishReviewEvent
  body: string
  comments: ReviewComment[]
}

/** Revisão validada, redigida e pronta para o site. */
export interface PreparedReview {
  event: PublishReviewEvent
  body: string
  comments: { path: string; line: number; side: 'RIGHT'; body: string }[]
}

export interface PostedReview {
  /** `https://github.com/<o>/<r>/pull/<n>#pullrequestreview-<id>` (validado) ou null. */
  url: string | null
}

export type ReviewPostErrorCode =
  /** Pedido inválido (evento, owner/repo/número, textos, limites, linha fora do diff). */
  | 'invalid'
  /** O site respondeu que não tem o GitHub App configurado. */
  | 'app_not_configured'
  /** O site publicado não tem a rota (versão antiga do site). */
  | 'site_outdated'
  /** Este build do app não sabe o endereço do site (sem `MAIN_VITE_SITE_URL` ou origem recusada). */
  | 'no_site'
  /** App não instalado no repositório (ou sem acesso às PRs): `details.installUrl`. */
  | 'not_installed'
  /** A conta conectada não tem push no repositório. */
  | 'forbidden'
  | 'not_connected'
  | 'rate_limited'
  /** GitHub ou site instável (5xx, resposta estranha). */
  | 'upstream'
  | 'network'
  | 'timeout'
  /**
   * Tempo esgotado ou queda de rede no POST da revisão ao site: o pedido pode ter chegado (e a
   * revisão, saído). Diferente de `timeout`/`network` das leituras ao GitHub antes de postar.
   */
  | 'site_timeout'
  | 'site_network'
  /** O GitHub recusou a revisão (422: linha fora do diff, PR fechada...). */
  | 'rejected'
  | 'not_found'

export class ReviewPostError extends Error {
  constructor(
    readonly code: ReviewPostErrorCode,
    message: string,
    readonly details: { installUrl?: string } = {}
  ) {
    super(message)
    this.name = 'ReviewPostError'
  }
}

export const REVIEW_MESSAGES = {
  notConfigured: 'O GitHub App do Orkio ainda não está configurado no site.',
  noSite: NO_SITE_MESSAGE,
  siteOutdated: 'O site do Orkio ainda não publica revisões (versão antiga do site).',
  notInstalled:
    'O GitHub App do Orkio não está instalado neste repositório (ou não tem acesso às PRs). ' +
    'Instale o App no repositório e tente de novo.',
  forbidden: 'Sua conta não tem permissão de push neste repositório.',
  rateLimited: 'Muitos pedidos seguidos ao site do Orkio. Aguarde um minuto e tente de novo.',
  upstream: 'O GitHub ou o site do Orkio está instável agora. Tente novamente em instantes.',
  approveRefused: 'O Orkio nunca aprova PRs: a revisão só pode comentar ou pedir alterações.',
  invalidTarget: 'Repositório ou número da PR inválido.',
  emptyBody: 'A revisão precisa de um resumo.',
  bodyTooLong: `O resumo da revisão passa de ${REVIEW_SUMMARY_MAX.toLocaleString('pt-BR')} caracteres.`,
  tooManyComments: `A revisão tem mais de ${REVIEW_COMMENTS_MAX} comentários de linha.`,
  badComment:
    'Um comentário de linha é inválido (arquivo, linha ou texto vazio, ou texto com mais de ' +
    `${REVIEW_COMMENT_MAX.toLocaleString('pt-BR')} caracteres).`,
  rejected: 'O GitHub recusou a revisão: confira as linhas dos comentários.',
  notFound: 'O GitHub não encontrou esta PR.',
  badRequest: 'O site do Orkio recusou a revisão como inválida.'
} as const

const MAX_PR_NUMBER = 2 ** 31

function invalid(message: string): ReviewPostError {
  return new ReviewPostError('invalid', message)
}

function checkTarget(owner: unknown, repo: unknown, number: unknown): void {
  if (
    typeof owner !== 'string' ||
    typeof repo !== 'string' ||
    !isOwner(owner) ||
    !isRepo(repo) ||
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > MAX_PR_NUMBER
  ) {
    throw invalid(REVIEW_MESSAGES.invalidTarget)
  }
}

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function isRepoPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > REVIEW_PATH_MAX) return false
  if (hasControlChar(path) || path.includes('\\') || path.startsWith('/')) return false
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

/**
 * Limpa e redige. Limpa de novo depois da redação (o marcador `[segredo omitido]` não pode formar
 * uma imagem com o texto em volta): assim aplicar duas vezes dá o mesmo texto, e o que o gate
 * mostra é o que o `postReview` manda.
 */
function cleanText(text: string): string {
  return sanitizeReviewText(redactSecrets(sanitizeReviewText(text))).trim()
}

/**
 * Valida, limpa (`sanitizeReviewText`: sem HTML nem imagens, para o gate mostrar exatamente o
 * que vai), redige e normaliza uma revisão (aceita `unknown`: o fluxo lê `.orkio/review.json`).
 * Lança `ReviewPostError('invalid')`; APPROVE (ou qualquer outro evento) é sempre recusado.
 */
export function prepareReview(input: unknown): PreparedReview {
  if (!isRecord(input)) throw invalid(REVIEW_MESSAGES.emptyBody)
  const event = input['event']
  if (event !== 'COMMENT' && event !== 'REQUEST_CHANGES') {
    throw invalid(REVIEW_MESSAGES.approveRefused)
  }
  const rawBody = input['body']
  // O GitHub exige resumo em COMMENT e REQUEST_CHANGES.
  if (typeof rawBody !== 'string') throw invalid(REVIEW_MESSAGES.emptyBody)
  const body = cleanText(rawBody)
  if (body.length === 0) throw invalid(REVIEW_MESSAGES.emptyBody)
  if (body.length > REVIEW_SUMMARY_MAX) throw invalid(REVIEW_MESSAGES.bodyTooLong)

  const rawComments = input['comments'] ?? []
  if (!Array.isArray(rawComments)) throw invalid(REVIEW_MESSAGES.badComment)
  if (rawComments.length > REVIEW_COMMENTS_MAX) throw invalid(REVIEW_MESSAGES.tooManyComments)
  const comments = rawComments.map((c: unknown) => {
    if (!isRecord(c)) throw invalid(REVIEW_MESSAGES.badComment)
    const { path, line } = c
    const text = typeof c['body'] === 'string' ? cleanText(c['body']) : ''
    if (
      !isRepoPath(path) ||
      typeof line !== 'number' ||
      !Number.isSafeInteger(line) ||
      line <= 0 ||
      text.length === 0 ||
      text.length > REVIEW_COMMENT_MAX
    ) {
      throw invalid(REVIEW_MESSAGES.badComment)
    }
    return { path, line, side: 'RIGHT' as const, body: text }
  })
  return { event, body, comments }
}

/**
 * Linhas do lado novo (RIGHT) que um comentário pode apontar, a partir do `patch` unificado de um
 * arquivo da PR: linhas adicionadas e de contexto dos hunks.
 */
export function rightSideLines(patch: string): Set<number> {
  const lines = new Set<number>()
  let right = 0
  let inHunk = false
  for (const raw of patch.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header) {
      right = Number(header[1])
      inHunk = true
      continue
    }
    if (!inHunk) continue
    const mark = raw[0]
    if (mark === '+' || mark === ' ') {
      lines.add(right)
      right++
    } else if (raw === '') {
      // linha de contexto vazia sem o espaço (patch cortado): conta como contexto
      lines.add(right)
      right++
    }
    // '-' (só no lado antigo) e '\' ("No newline at end of file") não avançam o lado novo
  }
  return lines
}

/** Comentários fora do diff → `ReviewPostError('invalid')` com o arquivo e a linha. */
export function checkCommentsAgainstDiff(
  comments: PreparedReview['comments'],
  files: Map<string, Set<number>>
): void {
  for (const c of comments) {
    if (!files.get(c.path)?.has(c.line)) {
      throw invalid(
        `O comentário em ${c.path}:${c.line} aponta para uma linha fora do diff da PR. ` +
          'Comentários de linha só valem em linhas adicionadas ou de contexto.'
      )
    }
  }
}

/** O que o poster usa do conector do GitHub (o token nunca passa por aqui). */
export interface ReviewGitHub {
  /** A origem do site é fixada no conector (construção); o poster não escolhe o destino. */
  postReviewViaOrkioSite(payload: OrkioSiteReviewPayload): Promise<OrkioSiteResponse>
  hasOrkioSite(): boolean
  getConditional(path: string, etag: string | null): Promise<ConditionalPage>
}

export interface GitHubReviewPosterDeps {
  github: ReviewGitHub
}

export class GitHubReviewPoster {
  constructor(private readonly deps: GitHubReviewPosterDeps) {}

  /** Há endereço do site configurado neste build? (sem rede) */
  isConfigured(): boolean {
    return this.deps.github.hasOrkioSite()
  }

  /** Linhas comentáveis (lado novo) por arquivo da PR. Lê `GET /pulls/{n}/files` pelo conector. */
  async diffLines(owner: string, repo: string, number: number): Promise<Map<string, Set<number>>> {
    checkTarget(owner, repo, number)
    const files = new Map<string, Set<number>>()
    let path: string | null =
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100`
    for (let page = 0; path && page < PR_FILES_MAX_PAGES; page++) {
      const result = await this.github(() => this.deps.github.getConditional(path!, null))
      if (result.notModified) break
      if (Array.isArray(result.body)) {
        for (const f of result.body) {
          if (!isRecord(f) || typeof f['filename'] !== 'string') continue
          // Sem `patch` (binário ou grande demais): nenhuma linha comentável.
          const patch = typeof f['patch'] === 'string' ? f['patch'] : ''
          files.set(f['filename'], rightSideLines(patch))
        }
      }
      path = result.nextPath
    }
    return files
  }

  /**
   * Posta a revisão como `orkio[bot]` pelo site. Valida tudo antes de qualquer rede (APPROVE
   * nunca); com comentários de linha, confere-os contra o diff da PR antes de mandar.
   */
  async postReview(
    owner: string,
    repo: string,
    number: number,
    review: ReviewInput
  ): Promise<PostedReview> {
    checkTarget(owner, repo, number)
    const prepared = prepareReview(review)
    if (!this.isConfigured()) {
      throw new ReviewPostError('no_site', REVIEW_MESSAGES.noSite)
    }
    if (prepared.comments.length > 0) {
      checkCommentsAgainstDiff(prepared.comments, await this.diffLines(owner, repo, number))
    }

    const response = await this.github(() =>
      this.deps.github.postReviewViaOrkioSite({ owner, repo, number, review: prepared })
    )
    return parseSiteResponse(response, owner, repo, number)
  }

  /**
   * Erros do conector → `ReviewPostError` (mensagens dele já são pt-BR e sem token). Rede/tempo no
   * POST ao site (serviço `site`) viram `site_network`/`site_timeout`: o pedido pode ter chegado.
   */
  private async github<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof ReviewPostError) throw error
      if (isApiError(error)) {
        const site = error.service === 'site'
        switch (error.code) {
          case 'not_connected':
            throw new ReviewPostError('not_connected', error.message)
          case 'no_site':
            throw new ReviewPostError('no_site', REVIEW_MESSAGES.noSite)
          case 'network':
            throw new ReviewPostError(site ? 'site_network' : 'network', error.message)
          case 'timeout':
            throw new ReviewPostError(site ? 'site_timeout' : 'timeout', error.message)
          case 'rate_limited':
            throw new ReviewPostError('rate_limited', error.message)
          case 'not_found':
            throw new ReviewPostError('not_found', REVIEW_MESSAGES.notFound)
        }
      }
      throw new ReviewPostError('upstream', REVIEW_MESSAGES.upstream)
    }
  }
}

/** Resposta do site → link da revisão ou `ReviewPostError`. Nada do corpo vai para mensagens. */
export function parseSiteResponse(
  response: OrkioSiteResponse,
  owner: string,
  repo: string,
  number: number
): PostedReview {
  const result = parseOrkioSiteResponse(response)
  switch (result.kind) {
    case 'ok':
      return { url: reviewUrlOrNull(result.body['url'], owner, repo, number) }
    case 'not_installed':
      throw new ReviewPostError(
        'not_installed',
        REVIEW_MESSAGES.notInstalled,
        result.installUrl ? { installUrl: result.installUrl } : {}
      )
    case 'forbidden':
      throw new ReviewPostError('forbidden', REVIEW_MESSAGES.forbidden)
    case 'app_not_configured':
      throw new ReviewPostError('app_not_configured', REVIEW_MESSAGES.notConfigured)
    case 'site_outdated':
      throw new ReviewPostError('site_outdated', REVIEW_MESSAGES.siteOutdated)
    case 'rate_limited':
      throw new ReviewPostError('rate_limited', REVIEW_MESSAGES.rateLimited)
    case 'bad_request':
      if (result.reason === 'rejected') {
        throw new ReviewPostError('rejected', REVIEW_MESSAGES.rejected)
      }
      if (result.reason === 'pr_not_found') {
        throw new ReviewPostError('not_found', REVIEW_MESSAGES.notFound)
      }
      throw invalid(REVIEW_MESSAGES.badRequest)
    case 'upstream':
      throw new ReviewPostError('upstream', REVIEW_MESSAGES.upstream)
  }
}

/**
 * Contrato da resposta do site do Orkio (`POST /github/review` e `/github/installation`,
 * `site/lib/github-app.ts`; códigos em `shared/site-contract.ts`): um leitor só, usado pela revisão (`review-poster.ts`) e pelo cartão do
 * orkio[bot] (`orkio-bot.ts`). Decide pelo código de erro do corpo (`error`); o status só vale
 * quando não há código (site sem a rota, limitador da Vercel, resposta estranha). Nada do corpo
 * vira mensagem: cada leitor tem os próprios textos.
 */
import { isInstallUrl } from '../../../shared/github-names'
import {
  isReviewRejectReason,
  isSiteGitHubError,
  type ReviewRejectReason,
  type SiteGitHubError
} from '../../../shared/site-contract'
import { isRecord } from '../../net/parse'
import type { OrkioSiteResponse } from './github.connector'

export type OrkioSiteResult =
  /** `installUrl`: o link de instalação do App, se o site mandou um válido. */
  | { kind: 'ok'; body: Record<string, unknown>; installUrl: string | null }
  /** `not_installed` (412): o GitHub App não está no repositório; link de instalação validado. */
  | { kind: 'not_installed'; installUrl: string | null }
  /** `forbidden` (403): a conta do usuário não tem acesso/push no repositório. */
  | { kind: 'forbidden' }
  /** `not_configured` (503): o GitHub App do Orkio não está configurado NO SITE. */
  | { kind: 'app_not_configured' }
  /** 404/405 sem código: site publicado antes desta rota. */
  | { kind: 'site_outdated' }
  | { kind: 'rate_limited' }
  /** `bad_request` (400): pedido recusado; `reason` quando o GitHub recusou ou a PR não existe. */
  | { kind: 'bad_request'; reason: ReviewRejectReason | null }
  /** `upstream` (502), 5xx ou qualquer outra coisa. */
  | { kind: 'upstream' }

export function parseOrkioSiteResponse(response: OrkioSiteResponse): OrkioSiteResult {
  const body = isRecord(response.body) ? response.body : {}
  const raw = body['error']
  const hasCode = typeof raw === 'string'
  const url = body['installUrl']
  const installUrl = isInstallUrl(url) ? url : null
  if (response.status === 200 && !hasCode) return { kind: 'ok', body, installUrl }
  if (isSiteGitHubError(raw)) return fromCode(raw, body, installUrl)
  // Sem código conhecido: decide pelo status.
  if (!hasCode && (response.status === 404 || response.status === 405)) {
    return { kind: 'site_outdated' }
  }
  if (response.status === 429) return { kind: 'rate_limited' }
  return { kind: 'upstream' }
}

function fromCode(
  code: SiteGitHubError,
  body: Record<string, unknown>,
  installUrl: string | null
): OrkioSiteResult {
  switch (code) {
    case 'not_installed':
      return { kind: 'not_installed', installUrl }
    case 'forbidden':
      return { kind: 'forbidden' }
    case 'not_configured':
      return { kind: 'app_not_configured' }
    case 'rate_limited':
      return { kind: 'rate_limited' }
    case 'bad_request': {
      const reason = body['reason']
      return { kind: 'bad_request', reason: isReviewRejectReason(reason) ? reason : null }
    }
    case 'upstream':
      return { kind: 'upstream' }
  }
}

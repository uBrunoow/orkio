/**
 * Contrato app ↔ site do Orkio (`site/`, package próprio na Vercel) do lado do app: o que os dois
 * lados precisam ter igual e que não mora em outro módulo do assunto (nomes do GitHub e a versão da
 * API do GitHub ficam em `github-names.ts`; limites da revisão em `review-publish.ts`;
 * `RELEASES_REPO` em `updates.ts`). O site tem a cópia dele num módulo só (`site/lib/contract.ts`);
 * `test/site-contract.test.ts` exige que os dois batam. Sem Node/DOM.
 */

/** Versão da API do Notion (header `Notion-Version`), a mesma do intermediário OAuth do site. */
export const NOTION_VERSION = '2026-03-11'

/**
 * Redirect URI do OAuth do Notion: cadastrado na conexão do Notion e em `ALLOWED_REDIRECT_URIS` do
 * site. `localhost` e não `127.0.0.1`: o Notion recusa IP em redirect URI (o servidor local escuta
 * só em 127.0.0.1 e confere o header Host).
 */
export const NOTION_OAUTH_REDIRECT_URI = 'http://localhost:47821/oauth/notion/callback'

/**
 * Códigos de erro de `POST /github/review` e `/github/installation` e o status de cada um
 * (`rate_limited` vem do limitador da rota). O app decide pelo código; o status só vale sem código.
 */
export const SITE_GITHUB_ERROR_STATUS = {
  not_configured: 503,
  bad_request: 400,
  forbidden: 403,
  // 412 e não 404: o app distingue "App não instalado" de "site sem a rota".
  not_installed: 412,
  upstream: 502,
  rate_limited: 429
} as const

export type SiteGitHubError = keyof typeof SITE_GITHUB_ERROR_STATUS

/** `reason` de um `bad_request` da revisão: o GitHub recusou (422) ou a PR não existe (404). */
export const REVIEW_REJECT_REASONS = ['rejected', 'pr_not_found'] as const
export type ReviewRejectReason = (typeof REVIEW_REJECT_REASONS)[number]

export function isSiteGitHubError(value: unknown): value is SiteGitHubError {
  return typeof value === 'string' && Object.hasOwn(SITE_GITHUB_ERROR_STATUS, value)
}

export function isReviewRejectReason(value: unknown): value is ReviewRejectReason {
  return (REVIEW_REJECT_REASONS as readonly unknown[]).includes(value)
}

/**
 * Só o link de revisão de uma PR em github.com: `https://github.com/<o>/<r>/pull/<n>` (com
 * `#pullrequestreview-<id>` opcional), sem porta, usuário/senha nem query.
 */
export function reviewUrlOrNull(
  value: unknown,
  owner: string,
  repo: string,
  number: number
): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      url.pathname.toLowerCase() === `/${owner}/${repo}/pull/${number}`.toLowerCase() &&
      /^(#pullrequestreview-\d+)?$/.test(url.hash)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

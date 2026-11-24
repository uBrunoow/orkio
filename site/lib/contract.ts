/**
 * Contrato site ↔ app do lado do site: tudo o que o app desktop também tem escrito (versões das
 * APIs, nomes do GitHub, limites e códigos de erro da revisão, redirect URI do Notion, repositório
 * e nomes dos arquivos dos releases). O site tem package próprio e não importa de `src/`; o resto
 * do site importa daqui, e `test/site-contract.test.ts` (na raiz) exige que cada valor bata com o
 * do app (`src/shared/site-contract.ts`, `github-names.ts`, `review-publish.ts`, `updates.ts`,
 * `release-artifacts.mts`).
 */

export const GITHUB_API_VERSION = '2026-03-10'
export const NOTION_VERSION = '2026-03-11'
/** Redirect URI do OAuth do Notion que o app usa (vai em `ALLOWED_REDIRECT_URIS`). */
export const NOTION_OAUTH_REDIRECT_URI = 'http://localhost:47821/oauth/notion/callback'
/** Repositório público do Orkio (código e releases), `owner/repo`. */
export const RELEASES_REPO = 'uBrunoow/orkio'

/** Login de usuário/organização: letras, dígitos, `-` e `_` (contas gerenciadas), até 100. */
export const OWNER_SLUG = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/
/** Nome de repositório: letras, dígitos, `.`, `_`, `-`, até 100 (nunca `.`/`..`). */
const REPO_SLUG = /^[A-Za-z0-9._-]{1,100}$/
/** Slug público do GitHub App (github.com/apps/<slug>). */
const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/

export function isRepoName(value: string): boolean {
  return REPO_SLUG.test(value) && value !== '.' && value !== '..'
}

export function isRepoPath(value: string): boolean {
  const [owner, repo, ...rest] = value.split('/')
  return rest.length === 0 && OWNER_SLUG.test(owner ?? '') && isRepoName(repo ?? '')
}

export function installUrl(slug: string): string | null {
  return APP_SLUG.test(slug) ? `https://github.com/apps/${slug}/installations/new` : null
}

/** Limites da revisão publicada (os mesmos do app: o app nunca manda mais que isso). */
export const REVIEW_BODY_MAX = 20_000
export const REVIEW_COMMENTS_MAX = 50
export const REVIEW_COMMENT_MAX = 4_000
export const REVIEW_PATH_MAX = 1_000

export const GITHUB_ERROR_STATUS = {
  not_configured: 503,
  bad_request: 400,
  forbidden: 403,
  // 412 e não 404: o app distingue "App não instalado" de "site sem a rota".
  not_installed: 412,
  upstream: 502,
  rate_limited: 429
} as const
export type GitHubRouteError = keyof typeof GITHUB_ERROR_STATUS

/** `reason` de um `bad_request` da revisão: o GitHub recusou (422) ou a PR não existe (404). */
export const REVIEW_REJECT_REASONS = ['rejected', 'pr_not_found'] as const
export type ReviewRejectReason = (typeof REVIEW_REJECT_REASONS)[number]

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

export type DownloadKind = 'mac-arm64' | 'mac-x64' | 'windows' | 'linux-appimage' | 'linux-deb'

/** Nome exato de cada arquivo de download no release da versão (o que o empacotador gera). */
export const DOWNLOAD_FILES: Readonly<Record<DownloadKind, (version: string) => string>> = {
  'mac-arm64': (v) => `Orkio-${v}-mac-arm64.dmg`,
  'mac-x64': (v) => `Orkio-${v}-mac-x64.dmg`,
  windows: (v) => `Orkio-${v}-win-x64-setup.exe`,
  'linux-appimage': (v) => `Orkio-${v}-linux-x86_64.AppImage`,
  'linux-deb': (v) => `Orkio-${v}-linux-amd64.deb`
}

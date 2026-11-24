/**
 * Origem do site do Orkio para a revisão como `orkio[bot]` (`POST /github/review`).
 *
 * O token OAuth do usuário vai para lá, então as regras são estritas:
 * - `MAIN_VITE_SITE_URL` em primeiro lugar; a origem do intermediário do Notion
 *   (`MAIN_VITE_NOTION_OAUTH_BROKER_URL`) só quando não há site (o intermediário ainda pode ser o
 *   Worker da Cloudflare, que não tem a rota `/github/review`);
 * - só `https:`; `http:` apenas em `127.0.0.1` e só em build de E2E (`--mode e2e`). Nunca
 *   `localhost` nem http no app empacotado;
 * - sem usuário/senha na URL.
 */
export interface OrkioSiteEnv {
  MODE?: string | undefined
  MAIN_VITE_NOTION_OAUTH_BROKER_URL?: string | undefined
  MAIN_VITE_SITE_URL?: string | undefined
}

/** A origem passa nas regras? `allowLoopbackHttp` só em build de E2E. */
export function isAllowedOrkioSiteOrigin(origin: string, allowLoopbackHttp: boolean): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.origin !== origin || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return allowLoopbackHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1'
}

/** Origem do site a partir da config de build, ou `null` (revisão como `orkio[bot]` indisponível). */
export function readOrkioSiteOrigin(env: OrkioSiteEnv): string | null {
  const raw = (env.MAIN_VITE_SITE_URL || env.MAIN_VITE_NOTION_OAUTH_BROKER_URL || '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  const origin = url.origin
  return isAllowedOrkioSiteOrigin(origin, env.MODE === 'e2e') ? origin : null
}

/**
 * Endereço do site do Orkio (`MAIN_VITE_SITE_URL`), a mesma origem para tudo que fala com ele: o
 * intermediário OAuth do Notion (`<site>/notion/*`), a revisão como `orkio[bot]` e a instalação do
 * GitHub App (`<site>/github/*`, com o token do usuário), e os links de Configurações > Sobre.
 *
 * Regras (o token do GitHub vai para lá):
 * - só a origem (caminho, busca e âncora da variável são ignorados); sem usuário/senha;
 * - `https:`; `http:` apenas em `127.0.0.1` e nunca em build de produção (o app empacotado):
 *   só em dev (site local) e no E2E.
 */
export interface SiteEnv {
  MODE?: string | undefined
  MAIN_VITE_SITE_URL?: string | undefined
}

const LOOPBACK_HOST = '127.0.0.1'

/** A origem passa nas regras? `allowLoopbackHttp` = build que não é de produção. */
export function isAllowedSiteOrigin(origin: string, allowLoopbackHttp: boolean): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.origin !== origin || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return allowLoopbackHttp && url.protocol === 'http:' && url.hostname === LOOPBACK_HOST
}

export function allowsLoopbackSite(env: SiteEnv): boolean {
  return env.MODE !== undefined && env.MODE !== 'production'
}

/** Origem do site a partir da config de build, ou `null` (sem site: recursos dele indisponíveis). */
export function siteOrigin(env: SiteEnv): string | null {
  const raw = (env.MAIN_VITE_SITE_URL ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  return isAllowedSiteOrigin(url.origin, allowsLoopbackSite(env)) ? url.origin : null
}

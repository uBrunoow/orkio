import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { RELEASES_PATH_PATTERN } from '../../shared/updates'
import type { SenderGuard } from './trusted-sender'

/**
 * O que o renderer pode abrir no navegador externo: só https, sem porta/credenciais, e só
 * estes hosts. `pathPrefix` restringe o caminho (ex.: no github.com só a página do Device Flow).
 */
export interface ExternalUrlRule {
  host: string
  pathPrefix?: string
  pathPattern?: RegExp
}

export const EXTERNAL_URL_RULES: readonly ExternalUrlRule[] = [
  { host: 'notion.so' },
  { host: 'www.notion.so' },
  { host: 'developers.notion.com' },
  { host: 'docs.github.com' },
  // Instalação/login do Claude Code (Etapa 4A).
  { host: 'code.claude.com', pathPrefix: '/docs' },
  { host: 'github.com', pathPrefix: '/login/device' },
  // Acesso de organizações (restrição de OAuth Apps / fine-grained PATs) e SSO (SAML).
  { host: 'github.com', pathPrefix: '/settings/connections/applications' },
  { host: 'github.com', pathPrefix: '/settings/personal-access-tokens' },
  { host: 'github.com', pathPattern: /^\/orgs\/[A-Za-z0-9-]+\/sso$/ },
  // PRs ligadas às tarefas (Etapa 2D).
  { host: 'github.com', pathPattern: /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/ },
  // Branch da tarefa enviada por um fluxo (Etapa 5C).
  {
    host: 'github.com',
    pathPattern: /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/tree\/[A-Za-z0-9._%-]+(\/[A-Za-z0-9._%-]+)*$/
  },
  // DMG/página de versão do repo PÚBLICO de releases (6C, macOS sem assinatura).
  { host: 'github.com', pathPattern: RELEASES_PATH_PATTERN }
]

/** Regras do site do Orkio (Configurações > Sobre), a partir do endereço do build. */
export function siteUrlRules(siteUrl: string | null): ExternalUrlRule[] {
  if (!siteUrl) return []
  try {
    const url = new URL(siteUrl)
    return url.protocol === 'https:' && !url.port ? [{ host: url.hostname }] : []
  } catch {
    return []
  }
}

export function isAllowedExternalUrl(
  value: unknown,
  extraRules: readonly ExternalUrlRule[] = []
): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  return [...EXTERNAL_URL_RULES, ...extraRules].some(
    (rule) =>
      rule.host === url.hostname &&
      (!rule.pathPrefix ||
        url.pathname === rule.pathPrefix ||
        url.pathname.startsWith(`${rule.pathPrefix}/`)) &&
      (!rule.pathPattern || rule.pathPattern.test(url.pathname))
  )
}

export function registerShellIpc(
  ipc: Pick<IpcMain, 'handle'>,
  openExternal: (url: string) => Promise<void>,
  isTrustedSender: SenderGuard,
  extraRules: readonly ExternalUrlRule[] = []
): void {
  ipc.handle(IPC_CHANNELS.shell.openExternal, async (event, url: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    if (!isAllowedExternalUrl(url, extraRules)) return false
    await openExternal(url)
    return true
  })
}

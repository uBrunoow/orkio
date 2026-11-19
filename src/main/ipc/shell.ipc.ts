import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { SenderGuard } from './trusted-sender'

/**
 * O que o renderer pode abrir no navegador externo: só https, sem porta/credenciais, e só
 * estes hosts. `pathPrefix` restringe o caminho (ex.: no github.com só a página do Device Flow).
 */
export const EXTERNAL_URL_RULES: readonly {
  host: string
  pathPrefix?: string
  pathPattern?: RegExp
}[] = [
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
  { host: 'github.com', pathPattern: /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/ }
]

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  return EXTERNAL_URL_RULES.some(
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
  isTrustedSender: SenderGuard
): void {
  ipc.handle(IPC_CHANNELS.shell.openExternal, async (event, url: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
    if (!isAllowedExternalUrl(url)) return false
    await openExternal(url)
    return true
  })
}

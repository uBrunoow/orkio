import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { SenderGuard } from './trusted-sender'

/**
 * O que o renderer pode abrir no navegador externo: só https, sem porta/credenciais, e só
 * estes hosts. `pathPrefix` restringe o caminho (ex.: no github.com só a página do Device Flow).
 */
export const EXTERNAL_URL_RULES: readonly { host: string; pathPrefix?: string }[] = [
  { host: 'notion.so' },
  { host: 'www.notion.so' },
  { host: 'developers.notion.com' },
  { host: 'docs.github.com' },
  { host: 'github.com', pathPrefix: '/login/device' }
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
        url.pathname.startsWith(`${rule.pathPrefix}/`))
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

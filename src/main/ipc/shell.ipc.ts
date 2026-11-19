import type { IpcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import type { SenderGuard } from './trusted-sender'

/** Domínios que o renderer pode abrir no navegador externo. */
export const EXTERNAL_URL_ALLOWLIST: ReadonlySet<string> = new Set([
  'notion.so',
  'www.notion.so',
  'developers.notion.com'
])

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      EXTERNAL_URL_ALLOWLIST.has(url.hostname)
    )
  } catch {
    return false
  }
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

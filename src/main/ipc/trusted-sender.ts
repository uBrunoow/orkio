import type { IpcMainInvokeEvent } from 'electron'

export interface TrustedOrigins {
  /** URL do dev server do Vite (ELECTRON_RENDERER_URL), só em desenvolvimento. */
  devServerUrl?: string | undefined
  /** URL file:// do index.html empacotado. */
  rendererFileUrl: string
}

/** Só aceitamos IPC vindo da nossa própria página (nunca de conteúdo remoto). */
export function isTrustedRendererUrl(url: string, origins: TrustedOrigins): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (origins.devServerUrl) {
    try {
      if (parsed.origin === new URL(origins.devServerUrl).origin) return true
    } catch {
      // devServerUrl inválida: ignora
    }
  }
  if (parsed.protocol === 'file:') {
    return parsed.pathname === new URL(origins.rendererFileUrl).pathname
  }
  return false
}

export type SenderGuard = (event: IpcMainInvokeEvent) => boolean

export function createSenderGuard(origins: TrustedOrigins): SenderGuard {
  return (event) => {
    const url = event.senderFrame?.url
    return typeof url === 'string' && isTrustedRendererUrl(url, origins)
  }
}

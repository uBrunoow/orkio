/**
 * Parser de URLs de remote git → repositório GitHub. Função pura.
 *
 * Formatos aceitos:
 *   https://github.com/owner/repo(.git)(/)      (também com usuário/token: https://x@github.com/...)
 *   git@github.com:owner/repo(.git)              (scp-like)
 *   ssh://git@github.com(:22)/owner/repo(.git)
 *
 * Classificação do host:
 *   github     → github.com / www.github.com / ssh.github.com
 *   ssh-alias  → host sem ponto (alias do ~/.ssh/config, ex. "github-trabalho"): pedir confirmação
 *   enterprise → outro domínio (GitHub Enterprise Server?): pedir confirmação
 * Qualquer outra coisa (caminho local, file://, git://, http sem dono/repo) → null.
 */

import { isOwner, isRepo } from '../../shared/github-names'

export type RemoteHostKind = 'github' | 'ssh-alias' | 'enterprise'

export interface ParsedRemote {
  /** Host como aparece no remote (sem usuário/porta). */
  host: string
  owner: string
  name: string
  kind: RemoteHostKind
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com'])
const HOST = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/

export function parseRemoteUrl(raw: string): ParsedRemote | null {
  const url = raw.trim()
  if (!url || /\s/.test(url)) return null

  // scp-like: [user@]host:owner/repo(.git) — sem "://" e com ":" antes da primeira "/".
  const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)([^\\]+)$/.exec(url)
  if (scp && !url.includes('://')) {
    // "C:\pasta" (Windows) não é remote: host de uma letra.
    if (scp[1]!.length === 1) return null
    return build(scp[1]!, scp[2]!)
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'ssh:') {
    return null
  }
  if (parsed.search || parsed.hash) return null
  return build(parsed.hostname, decodeURIComponent(parsed.pathname))
}

function build(hostRaw: string, pathRaw: string): ParsedRemote | null {
  const host = hostRaw.toLowerCase()
  if (!HOST.test(host)) return null

  const segments = pathRaw.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  if (segments.length !== 2) return null
  const owner = segments[0]!
  const name = segments[1]!.replace(/\.git$/i, '')
  if (!isOwner(owner) || !isRepo(name)) return null

  const kind: RemoteHostKind = GITHUB_HOSTS.has(host)
    ? 'github'
    : host.includes('.')
      ? 'enterprise'
      : 'ssh-alias'
  return { host, owner, name, kind }
}

/** Host usado na API para um remote confirmado: aliases de SSH apontam para github.com. */
export function apiHostFor(remote: ParsedRemote): string {
  return remote.kind === 'enterprise' ? remote.host : 'github.com'
}

/** Mesmo repositório? (GitHub não diferencia maiúsculas em owner/nome.) */
export function sameRepo(
  a: { owner: string; name: string },
  b: { owner: string; name: string }
): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase()
  )
}

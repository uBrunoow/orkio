/**
 * Download: último release do repositório público do Orkio (Etapa 6B), lido no servidor com ISR.
 * A sugestão do arquivo certo (SO/arquitetura) acontece no cliente (`suggestDownload`).
 */
import { DOWNLOAD_FILES, RELEASES_REPO, isRepoPath, type DownloadKind } from './contract'
import { githubHeaders } from './http'

export type { DownloadKind }

export interface DownloadFile {
  kind: DownloadKind
  name: string
  url: string
  size: number
}

export interface LatestRelease {
  version: string
  url: string
  publishedAt: string | null
  files: Partial<Record<DownloadKind, DownloadFile>>
}

export const RELEASE_REVALIDATE_SECONDS = 900

export function releasesRepo(value = process.env['RELEASES_REPO'] ?? RELEASES_REPO): string | null {
  const repo = value?.trim()
  return repo && isRepoPath(repo) ? repo : null
}

export function releasesPageUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest`
}

export function classifyAssets(
  assets: readonly { name: string; browser_download_url: string; size?: number }[],
  version: string
): Partial<Record<DownloadKind, DownloadFile>> {
  const out: Partial<Record<DownloadKind, DownloadFile>> = {}
  for (const kind of Object.keys(DOWNLOAD_FILES) as DownloadKind[]) {
    const name = DOWNLOAD_FILES[kind](version)
    const a = assets.find(
      (x) => x.name === name && x.browser_download_url.startsWith('https://github.com/')
    )
    if (a) out[kind] = { kind, name: a.name, url: a.browser_download_url, size: a.size ?? 0 }
  }
  return out
}

export function parseRelease(value: unknown, repo: string): LatestRelease | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const tag = typeof v['tag_name'] === 'string' ? v['tag_name'] : null
  if (!tag || v['draft'] === true || v['prerelease'] === true) return null
  const assets = Array.isArray(v['assets'])
    ? v['assets'].flatMap((a) => {
        if (typeof a !== 'object' || a === null) return []
        const r = a as Record<string, unknown>
        return typeof r['name'] === 'string' && typeof r['browser_download_url'] === 'string'
          ? [
              {
                name: r['name'],
                browser_download_url: r['browser_download_url'],
                size: typeof r['size'] === 'number' ? r['size'] : 0
              }
            ]
          : []
      })
    : []
  const version = tag.replace(/^v/, '')
  return {
    version,
    url: releasesPageUrl(repo),
    publishedAt: typeof v['published_at'] === 'string' ? v['published_at'] : null,
    files: classifyAssets(assets, version)
  }
}

/** Último release (ISR). Sem repositório configurado ou falha → `null` (o site usa o fallback). */
export async function getLatestRelease(
  repo = releasesRepo(),
  fetchImpl: typeof fetch = fetch
): Promise<LatestRelease | null> {
  if (!repo) return null
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: githubHeaders(),
      next: { revalidate: RELEASE_REVALIDATE_SECONDS }
    } as RequestInit)
    if (!res.ok) return null
    return parseRelease(await res.json(), repo)
  } catch {
    return null
  }
}

/** Sistema e arquitetura vistos no navegador (`null` = não deu para saber). */
export interface ClientPlatform {
  os: 'mac' | 'windows' | 'linux' | 'other'
  arch: 'arm' | 'x86' | null
}

export function detectPlatform(input: {
  userAgent: string
  platform?: string | undefined
  uaDataPlatform?: string | undefined
  architecture?: string | undefined
}): ClientPlatform {
  const ua = input.userAgent.toLowerCase()
  const plat = (input.uaDataPlatform ?? input.platform ?? '').toLowerCase()
  const os: ClientPlatform['os'] =
    /mac|darwin/.test(plat) || (/macintosh|mac os x/.test(ua) && !/iphone|ipad/.test(ua))
      ? 'mac'
      : /win/.test(plat) || /windows/.test(ua)
        ? 'windows'
        : /linux/.test(plat) || /linux/.test(ua)
          ? 'linux'
          : 'other'
  const a = (input.architecture ?? '').toLowerCase()
  const arch: ClientPlatform['arch'] = a.startsWith('arm') ? 'arm' : a === 'x86' ? 'x86' : null
  return { os, arch }
}

/**
 * Arquivo sugerido. Mac sem arquitetura conhecida (Safari/Firefox não informam): Apple Silicon,
 * com o Intel oferecido ao lado. Linux: o AppImage (qualquer distro, atualiza sozinho), senão o .deb.
 * Outros: sem sugestão.
 */
export function suggestDownload(
  platform: ClientPlatform,
  files: LatestRelease['files']
): DownloadFile | null {
  if (platform.os === 'windows') return files.windows ?? null
  if (platform.os === 'mac') {
    if (platform.arch === 'x86') return files['mac-x64'] ?? files['mac-arm64'] ?? null
    return files['mac-arm64'] ?? files['mac-x64'] ?? null
  }
  if (platform.os === 'linux') {
    // Os arquivos do Linux são x64: num ARM, nenhum serve.
    if (platform.arch === 'arm') return null
    return files['linux-appimage'] ?? files['linux-deb'] ?? null
  }
  return null
}

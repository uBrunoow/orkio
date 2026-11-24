/**
 * Download: último release do repositório público de binários (Etapa 6B), lido no servidor com
 * ISR. A sugestão do arquivo certo (SO/arquitetura) acontece no cliente (`suggestDownload`).
 */

export type DownloadKind = 'mac-arm64' | 'mac-x64' | 'windows' | 'linux-appimage' | 'linux-deb'

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

/** Revalidação do release (segundos): 15 min. */
export const RELEASE_REVALIDATE_SECONDS = 900
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

/** Repositório público do Orkio (app + releases); vale quando `RELEASES_REPO` não está definido. */
export const DEFAULT_RELEASES_REPO = 'uBrunoow/orkio'

export function releasesRepo(
  value = process.env['RELEASES_REPO'] ?? DEFAULT_RELEASES_REPO
): string | null {
  const repo = value?.trim()
  return repo && REPO.test(repo) ? repo : null
}

export function releasesPageUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest`
}

/** Classifica os arquivos do release pelo nome (convenção do electron-builder). */
export function classifyAssets(
  assets: readonly { name: string; browser_download_url: string; size?: number }[]
): Partial<Record<DownloadKind, DownloadFile>> {
  const out: Partial<Record<DownloadKind, DownloadFile>> = {}
  const set = (kind: DownloadKind, a: (typeof assets)[number], priority: boolean): void => {
    if (out[kind] && !priority) return
    out[kind] = { kind, name: a.name, url: a.browser_download_url, size: a.size ?? 0 }
  }
  for (const a of assets) {
    const name = a.name.toLowerCase()
    if (!a.browser_download_url.startsWith('https://github.com/')) continue
    if (/\.(blockmap|yml|yaml|sig|sha256|txt)$/.test(name)) continue
    if (name.endsWith('.dmg') || (name.endsWith('.zip') && /mac|darwin/.test(name))) {
      const dmg = name.endsWith('.dmg')
      if (/universal/.test(name)) {
        set('mac-arm64', a, false)
        set('mac-x64', a, false)
      } else if (/arm64|aarch64|apple-?silicon/.test(name)) set('mac-arm64', a, dmg)
      else if (/x64|x86_64|intel|amd64/.test(name)) set('mac-x64', a, dmg)
      else set('mac-x64', a, false) // sem arquitetura no nome: o padrão do electron-builder é x64
    } else if (name.endsWith('.exe') && !/uninstall/.test(name)) set('windows', a, true)
    else if (name.endsWith('.msi')) set('windows', a, false)
    else if (name.endsWith('.appimage') && !/arm64|aarch64/.test(name))
      set('linux-appimage', a, true)
    else if (name.endsWith('.deb') && !/arm64|aarch64/.test(name)) set('linux-deb', a, true)
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
  return {
    version: tag.replace(/^v/, ''),
    url: releasesPageUrl(repo),
    publishedAt: typeof v['published_at'] === 'string' ? v['published_at'] : null,
    files: classifyAssets(assets)
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
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'orkio-site'
      },
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
    if (platform.arch === 'arm') return null // só há build x64
    return files['linux-appimage'] ?? files['linux-deb'] ?? null
  }
  return null
}

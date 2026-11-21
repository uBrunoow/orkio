import { describe, expect, it, vi } from 'vitest'
import {
  classifyAssets,
  detectPlatform,
  getLatestRelease,
  parseRelease,
  releasesRepo,
  suggestDownload
} from './releases'

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/acme/orkio-releases/releases/download/v1.2.0/${name}`,
  size: 100
})
const RELEASE = {
  tag_name: 'v1.2.0',
  draft: false,
  prerelease: false,
  published_at: '2026-11-20T00:00:00Z',
  assets: [
    asset('Orkio-1.2.0-arm64.dmg'),
    asset('Orkio-1.2.0-arm64.dmg.blockmap'),
    asset('Orkio-1.2.0-arm64-mac.zip'),
    asset('Orkio-1.2.0-x64.dmg'),
    asset('Orkio-Setup-1.2.0.exe'),
    asset('latest.yml')
  ]
}

describe('download', () => {
  it('classifica dmg arm64/x64 e o instalador do Windows (ignora blockmap, yml, zip)', () => {
    const r = parseRelease(RELEASE, 'acme/orkio-releases')!
    expect(r.version).toBe('1.2.0')
    expect(r.url).toBe('https://github.com/acme/orkio-releases/releases/latest')
    expect(r.files['mac-arm64']?.name).toBe('Orkio-1.2.0-arm64.dmg')
    expect(r.files['mac-x64']?.name).toBe('Orkio-1.2.0-x64.dmg')
    expect(r.files.windows?.name).toBe('Orkio-Setup-1.2.0.exe')
    expect(classifyAssets([asset('Orkio-1.0.0-universal.dmg')])).toMatchObject({
      'mac-arm64': { name: 'Orkio-1.0.0-universal.dmg' },
      'mac-x64': { name: 'Orkio-1.0.0-universal.dmg' }
    })
    // Link fora do github.com é ignorado.
    expect(
      classifyAssets([{ name: 'x.exe', browser_download_url: 'https://evil.example/x.exe' }])
    ).toEqual({})
    expect(parseRelease({ ...RELEASE, draft: true }, 'a/b')).toBeNull()
  })

  it('repositório inválido ou ausente → sem chamada (fallback)', async () => {
    expect(releasesRepo('')).toBeNull()
    expect(releasesRepo('acme/orkio releases')).toBeNull()
    expect(releasesRepo('../../x')).toBeNull()
    const f = vi.fn<typeof fetch>()
    expect(await getLatestRelease(null, f)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('lê o último release com revalidação; erro da API → null', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(RELEASE)))
    const r = await getLatestRelease('acme/orkio-releases', f)
    expect(r?.files.windows).toBeTruthy()
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api.github.com/repos/acme/orkio-releases/releases/latest')
    expect((init as { next?: { revalidate?: number } }).next?.revalidate).toBe(900)
    expect(
      await getLatestRelease('a/b', async () => new Response('{}', { status: 404 }))
    ).toBeNull()
    expect(
      await getLatestRelease('a/b', async () => {
        throw new TypeError('rede')
      })
    ).toBeNull()
  })

  it('detecta SO/arquitetura e sugere o arquivo', () => {
    const files = parseRelease(RELEASE, 'a/b')!.files
    const mac = detectPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'
    })
    expect(mac).toEqual({ os: 'mac', arch: null })
    expect(suggestDownload(mac, files)?.name).toBe('Orkio-1.2.0-arm64.dmg') // Apple Silicon
    const intel = detectPlatform({ userAgent: '', uaDataPlatform: 'macOS', architecture: 'x86' })
    expect(suggestDownload(intel, files)?.name).toBe('Orkio-1.2.0-x64.dmg')
    const win = detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    expect(suggestDownload(win, files)?.name).toBe('Orkio-Setup-1.2.0.exe')
    const linux = detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })
    expect(suggestDownload(linux, files)).toBeNull()
    const iphone = detectPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    })
    expect(iphone.os).toBe('other')
  })
})

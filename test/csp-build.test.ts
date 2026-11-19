import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, type InlineConfig, type Plugin } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import electronViteConfig from '../electron.vite.config'

/**
 * Garante que o build de PRODUÇÃO do renderer mantém a CSP estrita.
 * Roda um `vite build` real com a mesma config do electron-vite.
 */
const rendererConfig = (electronViteConfig as { renderer: InlineConfig }).renderer

function cspOf(html: string): string {
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
  if (!match?.[1]) throw new Error('CSP não encontrada no index.html')
  return match[1]
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name!, values])
  )
}

describe('CSP do build de produção', () => {
  let outDir: string
  let html: string
  let css: string

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'orkio-csp-build-'))
    await build({
      ...rendererConfig,
      configFile: false,
      logLevel: 'silent',
      mode: 'production',
      build: { ...rendererConfig.build, outDir, emptyOutDir: true }
    })
    html = readFileSync(join(outDir, 'index.html'), 'utf8')
    const assets = readdirSync(join(outDir, 'assets'))
    css = assets
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
      .join('\n')
  }, 60_000)

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it("não contém 'unsafe-inline' nem 'unsafe-eval'", () => {
    const csp = cspOf(html)
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
  })

  it('mantém as diretivas estritas esperadas', () => {
    const d = directives(cspOf(html))
    expect(d.get('default-src')).toEqual(["'none'"])
    expect(d.get('script-src')).toEqual(["'self'"])
    expect(d.get('style-src')).toEqual(["'self'"])
    expect(d.get('font-src')).toEqual(["'self'"])
    expect(d.get('connect-src')).toEqual(["'self'"])
    expect(d.get('object-src')).toEqual(["'none'"])
    expect(d.get('base-uri')).toEqual(["'none'"])
  })

  it('não gera <script> ou <style> inline no HTML', () => {
    const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inlineScripts).toEqual([])
    expect(html).not.toMatch(/<style\b/)
    expect(html).not.toMatch(/\sstyle="/)
  })

  it('fontes não viram data: URI (font-src só permite self)', () => {
    expect(css).toContain('.woff2')
    expect(css).not.toMatch(/url\(\s*["']?data:font/)
  })

  it('o relaxamento de style-src só se aplica ao dev server', () => {
    const plugins = (rendererConfig.plugins ?? []).flat() as Plugin[]
    const relaxer = plugins.find((p) => p?.name === 'orkio:dev-only-relaxed-style-csp')
    expect(relaxer?.apply).toBe('serve')
  })
})

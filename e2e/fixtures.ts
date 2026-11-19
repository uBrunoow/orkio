import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export const ROOT = resolve(__dirname, '..')

/** Comportamento da API do Notion simulada dentro do processo main. */
export type FakeNotionMode = 'ok' | '401' | '503'

interface FakeGlobals {
  __notionMode: FakeNotionMode
  __notionCalls: { url: string; version: string | undefined }[]
  __opened: string[]
}

export interface OrkioApp {
  app: ElectronApplication
  page: Page
  /** stdout/stderr do processo e console do renderer. */
  logs: string[]
}

export function createUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'orkio-e2e-'))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Abre o app (out/) com um userData isolado e substitui, no processo main:
 * - fetch → API do Notion simulada (sem rede, sem backdoor no código do app);
 * - shell.openExternal → só registra a URL;
 * - no Linux sem keyring, liga a criptografia básica do Electron só para o teste
 *   (o app de verdade recusa esse backend).
 */
export async function launchOrkio(userDataDir: string, mode: FakeNotionMode): Promise<OrkioApp> {
  const env = { ...process.env } as Record<string, string>
  // Opções do Node que o Electron rejeita (ex.: --use-openssl-ca) poluem o log.
  delete env['NODE_OPTIONS']

  const args = ['.', `--user-data-dir=${userDataDir}`]
  // Chromium não roda como root sem --no-sandbox (containers de CI).
  if (process.getuid?.() === 0) args.push('--no-sandbox')

  const app = await electron.launch({ args, cwd: ROOT, env })
  const logs: string[] = []
  app.process().stdout?.on('data', (d: Buffer) => logs.push(String(d)))
  app.process().stderr?.on('data', (d: Buffer) => logs.push(String(d)))

  await app.evaluate(({ safeStorage, shell }, initialMode) => {
    const g = globalThis as unknown as FakeGlobals
    if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
      safeStorage.setUsePlainTextEncryption(true)
      safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
    }
    g.__notionMode = initialMode
    g.__notionCalls = []
    g.__opened = []
    shell.openExternal = async (url: string) => {
      g.__opened.push(url)
    }
    globalThis.fetch = async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      g.__notionCalls.push({ url: String(input), version: headers['Notion-Version'] })
      if (g.__notionMode === '401') {
        return new Response(JSON.stringify({ object: 'error', code: 'unauthorized' }), {
          status: 401
        })
      }
      if (g.__notionMode === '503') return new Response('indisponível', { status: 503 })
      return new Response(
        JSON.stringify({
          object: 'user',
          id: 'u1',
          type: 'person',
          name: 'Ada Lovelace',
          avatar_url: null
        }),
        { status: 200 }
      )
    }
  }, mode)

  const page = await app.firstWindow()
  page.on('console', (m) => logs.push(m.text()))
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)
    )
  })
  await page.setViewportSize({ width: 1100, height: 720 })
  // Recarrega para que o status inicial já passe pelos fakes acima.
  await page.reload()
  return { app, page, logs }
}

export async function setNotionMode(app: ElectronApplication, mode: FakeNotionMode): Promise<void> {
  await app.evaluate((_electron, next) => {
    ;(globalThis as unknown as FakeGlobals).__notionMode = next
  }, mode)
}

export async function notionCalls(app: ElectronApplication): Promise<FakeGlobals['__notionCalls']> {
  return app.evaluate(() => (globalThis as unknown as FakeGlobals).__notionCalls)
}

export async function openedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as FakeGlobals).__opened)
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
}

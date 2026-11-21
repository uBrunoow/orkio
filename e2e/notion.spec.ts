import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  externalCalls,
  launchOrkio,
  notionCard,
  openedUrls,
  removeDir,
  setFakes,
  type FakeServices,
  type OrkioApp,
  alerts
} from './fixtures'

const TOKEN = 'ntn_E2E_SECRET_TOKEN_abcdef123456'

// Os testes compartilham o mesmo userData: rodam em ordem e dependem do anterior.
test.describe.configure({ mode: 'serial' })

let userDataDir: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

const secretsDir = (): string => join(userDataDir, 'secrets')
const secretFiles = (): string[] => (existsSync(secretsDir()) ? readdirSync(secretsDir()) : [])

async function open(notion: FakeServices['notion']): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, { notion })
  return orkio
}

async function close(): Promise<void> {
  if (!orkio) return
  allLogs.push(...orkio.logs)
  await orkio.app.close()
  orkio = null
}

test.beforeAll(() => {
  userDataDir = createUserDataDir()
})

test.afterAll(async () => {
  await close()
  removeDir(userDataDir)
})

test('abre na tela de Integrações, isolado e com a identidade visual', async () => {
  const { page } = await open('401')

  await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible()
  await expect(notionCard(page).getByText('Desconectado')).toBeVisible()

  const isolation = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    api: Object.keys(window.orkio),
    notion: Object.keys(window.orkio.notion),
    github: Object.keys(window.orkio.github),
    projects: Object.keys(window.orkio.projects),
    notionWorkspace: Object.keys(window.orkio.notionWorkspace),
    signals: Object.keys(window.orkio.signals),
    board: Object.keys(window.orkio.board),
    automation: Object.keys(window.orkio.automation),
    flow: Object.keys(window.orkio.flow),
    overview: Object.keys(window.orkio.overview)
  }))
  expect(isolation).toEqual({
    require: 'undefined',
    process: 'undefined',
    api: [
      'notion',
      'github',
      'notionWorkspace',
      'board',
      'flow',
      'automation',
      'alva',
      'taskFlows',
      'claude',
      'signals',
      'projects',
      'updates',
      'overview',
      'openExternal'
    ],
    overview: ['get', 'refresh', 'activity', 'onChanged'],
    notion: [
      'getStatus',
      'connect',
      'disconnect',
      'testConnection',
      'getAuthOptions',
      'startOAuth',
      'cancelOAuth'
    ],
    github: [
      'getStatus',
      'connect',
      'disconnect',
      'testConnection',
      'getAuthOptions',
      'startDeviceFlow',
      'waitDeviceFlow',
      'cancelDeviceFlow'
    ],
    projects: [
      'list',
      'revalidate',
      'pickFolder',
      'create',
      'relocate',
      'remove',
      'onBranchChanged'
    ],
    notionWorkspace: [
      'getStatus',
      'revalidate',
      'listDataSources',
      'getTasksSchema',
      'save',
      'clear',
      'listProjectChoices',
      'link',
      'unlink',
      'listTasks'
    ],
    signals: ['get'],
    board: [
      'get',
      'save',
      'move',
      'setBlocked',
      'history',
      'retryNow',
      'setAutomationPaused',
      'onChanged',
      'onOpenTask',
      'onSyncChanged'
    ],
    automation: ['status', 'runNow', 'setPaused'],
    flow: ['save', 'events', 'exportFile', 'importFile']
  })

  // O login com Notion (OAuth) é a ação principal; o token fica atrás de "Usar token".
  await expect(notionCard(page).getByRole('button', { name: 'Conectar com Notion' })).toBeVisible()
  await notionCard(page).getByRole('button', { name: 'Usar token' }).click()

  // Fontes locais, logo e botão primário.
  await notionCard(page).getByLabel('Token do Notion').fill('x')
  await page.waitForTimeout(300) // fim da transição de cor do botão
  await notionCard(page)
    .getByRole('button', { name: 'Conectar', exact: true })
    .evaluate((el) => el.setAttribute('data-primary-probe', ''))
  const visual = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('300 30px Jost'),
      document.fonts.load('400 16px Jost'),
      document.fonts.load('400 14px Inter'),
      document.fonts.load('400 13px "JetBrains Mono"')
    ])
    const css = (selector: string, prop: keyof CSSStyleDeclaration): string => {
      const el = document.querySelector(selector)
      return el ? String(getComputedStyle(el)[prop]) : ''
    }
    const sidebarLogo = document.querySelector<HTMLElement>('nav .orkio-logo')
    const heroLogo = document.querySelector<HTMLElement>('[data-testid="empty-hero"] .orkio-logo')
    return {
      fonts: [...document.fonts]
        .filter((f) => f.status === 'loaded')
        .map((f) => `${f.family} ${f.weight}`),
      body: css('body', 'fontFamily'),
      input: css('input[type="password"]', 'fontFamily'),
      primary: [
        css('[data-primary-probe]', 'backgroundColor'),
        css('[data-primary-probe]', 'color')
      ],
      sidebarVariant: sidebarLogo?.dataset['variant'],
      sidebarColor: css('nav .orkio-logo', 'color'),
      wordmark: [
        css('nav .orkio-logo__wordmark', 'fontFamily'),
        css('nav .orkio-logo__wordmark', 'fontWeight')
      ],
      heroVariant: heroLogo?.dataset['variant']
    }
  })
  await notionCard(page).getByLabel('Token do Notion').fill('')

  for (const font of ['Inter 400', 'Jost 300', 'Jost 400', 'JetBrains Mono 400']) {
    expect(visual.fonts).toContain(font)
  }
  expect(visual.body).toMatch(/^Inter/)
  expect(visual.input).toMatch(/^"JetBrains Mono"/)
  expect(visual.primary).toEqual(['rgb(255, 91, 31)', 'rgb(10, 10, 11)'])
  expect(visual.sidebarVariant).toBe('simple')
  expect(visual.sidebarColor).toBe('rgb(255, 91, 31)')
  expect(visual.wordmark[0]).toMatch(/^Jost/)
  expect(visual.wordmark[1]).toBe('400')
  expect(visual.heroVariant).toBe('full')
})

test('build de produção carrega a CSP estrita, sem violações', async () => {
  const { page } = orkio!
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("style-src 'self'")
  expect(csp).not.toContain('unsafe-inline')
  expect(csp).not.toContain('unsafe-eval')
  expect(await cspViolations(page)).toEqual([])
})

test('link "Como criar um token" usa openExternal com allowlist', async () => {
  const { app, page } = orkio!
  await notionCard(page)
    .getByRole('button', { name: /Como criar um token/ })
    .click()
  await expect
    .poll(() => openedUrls(app))
    .toEqual(['https://developers.notion.com/guides/get-started/personal-access-tokens'])
  expect(await page.evaluate(() => window.orkio.openExternal('https://evil.example.com'))).toBe(
    false
  )
})

test('token inválido → erro claro e nada é salvo', async () => {
  const { page } = orkio!
  await notionCard(page).getByLabel('Token do Notion').fill(TOKEN)
  await expect(notionCard(page).getByLabel('Token do Notion')).toHaveAttribute('type', 'password')
  await notionCard(page).getByRole('button', { name: 'Conectar', exact: true }).click()

  await expect(alerts(notionCard(page))).toContainText('Token inválido ou revogado')
  expect(secretFiles()).toEqual([])
})

test('token válido → conectado, salvo criptografado, token fora do renderer', async () => {
  const { app, page } = orkio!
  await setFakes(app, { notion: 'ok' })
  await notionCard(page).getByRole('button', { name: 'Tentar novamente' }).click()

  await expect(notionCard(page).getByText('Ada Lovelace', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('empty-hero')).toHaveCount(0)
  await expect(notionCard(page).getByLabel('Token do Notion')).toHaveCount(0)

  // Depois de conectar, o assistente dos bancos também consulta o Notion (/search).
  const calls = await externalCalls(app)
  expect(calls.filter((c) => c.url === 'https://api.notion.com/v1/users/me').at(-1)).toMatchObject({
    version: '2026-03-11',
    auth: `Bearer ${TOKEN}`
  })
  expect(
    calls.every((c) => !c.url.startsWith('https://api.notion.com') || c.version === '2026-03-11')
  ).toBe(true)

  expect(secretFiles()).toEqual(['notion.bin'])
  const file = join(secretsDir(), 'notion.bin')
  const raw = readFileSync(file)
  expect(raw.includes(TOKEN)).toBe(false)
  expect(raw.includes('Ada')).toBe(false)
  if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)

  const status = await page.evaluate(() => window.orkio.notion.getStatus())
  expect(JSON.stringify(status)).not.toContain(TOKEN)
  await close()
})

test('reabrir o app mantém a conexão e revalida em segundo plano', async () => {
  const { page } = await open('ok')
  await expect(notionCard(page).getByText('Ada Lovelace', { exact: true }).first()).toBeVisible()
  await expect(notionCard(page).getByText(/Verificado às/)).toBeVisible()
})

test('falha transitória (503) mantém conectado com aviso', async () => {
  const { app, page } = orkio!
  await setFakes(app, { notion: '503' })
  await notionCard(page).getByRole('button', { name: 'Testar conexão' }).click()
  await expect(notionCard(page).getByRole('status').filter({ hasText: '503' })).toBeVisible()
  await expect(notionCard(page).getByText('Ada Lovelace', { exact: true }).first()).toBeVisible()
})

test('token revogado (401) na revalidação → erro com opções', async () => {
  const { app, page } = orkio!
  await setFakes(app, { notion: '401' })
  await notionCard(page).getByRole('button', { name: 'Testar conexão' }).click()
  await expect(alerts(notionCard(page))).toBeVisible()
  await expect(notionCard(page).getByRole('button', { name: 'Tentar novamente' })).toBeVisible()
  expect(secretFiles()).toEqual(['notion.bin'])
})

test('desconectar pede confirmação e apaga o token do disco', async () => {
  const { page } = orkio!
  await notionCard(page).getByRole('button', { name: 'Desconectar' }).click()
  await expect(notionCard(page).getByText('Remover a conexão deste computador?')).toBeVisible()
  expect(secretFiles()).toEqual(['notion.bin'])

  await page
    .getByRole('group', { name: 'Confirmar desconexão' })
    .getByRole('button', { name: 'Desconectar' })
    .click()

  await expect(notionCard(page).getByRole('button', { name: 'Conectar com Notion' })).toBeVisible()
  await expect(notionCard(page).getByText('Desconectado')).toBeVisible()
  expect(secretFiles()).toEqual([])
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('nenhum token aparece em logs do processo ou do console', () => {
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(TOKEN)
  expect(logs).not.toMatch(/Content Security Policy/)
})

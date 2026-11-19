import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  E2E_BROKER_URL,
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

const REDIRECT_URI = 'http://127.0.0.1:47821/oauth/notion/callback'

// Compartilham o mesmo userData: rodam em ordem.
test.describe.configure({ mode: 'serial' })

let userDataDir: string
let orkio: OrkioApp | null = null
const allLogs: string[] = []

const secretFiles = (): string[] => {
  const dir = join(userDataDir, 'secrets')
  return existsSync(dir) ? readdirSync(dir) : []
}

/** Screenshots opcionais para revisão visual: ORKIO_E2E_SCREENSHOTS=/pasta pnpm e2e */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['ORKIO_E2E_SCREENSHOTS']
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) })
}

async function open(fakes: Partial<FakeServices> = {}): Promise<OrkioApp> {
  orkio = await launchOrkio(userDataDir, fakes)
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

test('"Conectar com Notion" autoriza no navegador e conecta via intermediário', async () => {
  const { app, page } = await open()
  await shot(page, 'oauth-1-desconectado')

  await notionCard(page).getByRole('button', { name: 'Conectar com Notion' }).click()

  await expect(notionCard(page).getByText('Grace Hopper', { exact: true }).first()).toBeVisible()
  await expect(notionCard(page).getByText(/Acme Labs/)).toBeVisible()
  await expect(page.getByTestId('empty-hero')).toHaveCount(0)
  await shot(page, 'oauth-2-conectado')

  // Página de autorização aberta no navegador com os parâmetros certos.
  const [authorizeUrl] = await openedUrls(app)
  const url = new URL(authorizeUrl!)
  expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
  expect(url.searchParams.get('client_id')).toBe('e2e-client-id')
  expect(url.searchParams.get('response_type')).toBe('code')
  expect(url.searchParams.get('owner')).toBe('user')
  expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
  expect(url.searchParams.get('state')?.length).toBeGreaterThanOrEqual(32)

  // O code foi trocado no intermediário, sem nenhum segredo saindo do app.
  const brokerCall = (await externalCalls(app)).find((c) => c.url.startsWith(E2E_BROKER_URL))
  expect(brokerCall?.url).toBe(`${E2E_BROKER_URL}/notion/token`)
  expect(brokerCall?.auth).toBeUndefined()
  expect(JSON.parse(brokerCall!.body!)).toEqual({
    code: 'e2e-auth-code',
    redirect_uri: REDIRECT_URI
  })

  // Tokens salvos cifrados, e nunca no renderer.
  expect(secretFiles()).toEqual(['notion.bin'])
  const raw = readFileSync(join(userDataDir, 'secrets', 'notion.bin'))
  expect(raw.includes('ntn_E2E_OAUTH')).toBe(false)
  expect(raw.includes('nrt_E2E_OAUTH')).toBe(false)
  const status = await page.evaluate(() => window.orkio.notion.getStatus())
  expect(JSON.stringify(status)).not.toMatch(/E2E_OAUTH|e2e-auth-code/)
  await close()
})

test('reabrir o app mantém a conexão OAuth', async () => {
  const { page } = await open()
  await expect(notionCard(page).getByText('Grace Hopper', { exact: true }).first()).toBeVisible()
  await expect(notionCard(page).getByText(/Verificado às/)).toBeVisible()
})

test('token de acesso expirado → renova pelo intermediário automaticamente', async () => {
  const { app, page } = orkio!
  // Só o access token da 2ª geração vale: o 1º recebe 401 e força a renovação.
  await setFakes(app, { validTokens: ['ntn_E2E_OAUTH_ACCESS_2'] })
  await notionCard(page).getByRole('button', { name: 'Testar conexão' }).click()

  await expect(notionCard(page).getByText(/Verificado às/)).toBeVisible()
  await expect(alerts(notionCard(page))).toHaveCount(0)
  const refresh = (await externalCalls(app)).find((c) => c.url.endsWith('/notion/refresh'))
  expect(JSON.parse(refresh!.body!)).toEqual({ refresh_token: 'nrt_E2E_OAUTH_REFRESH_1' })
})

test('autorização revogada → erro com "Reconectar com Notion"', async () => {
  const { app, page } = orkio!
  await setFakes(app, { validTokens: [], broker: 'invalid_grant' })
  await notionCard(page).getByRole('button', { name: 'Testar conexão' }).click()

  await expect(alerts(notionCard(page))).toContainText('expirou ou foi revogada')
  await shot(page, 'oauth-3-revogado')
  expect(secretFiles()).toEqual(['notion.bin'])

  await setFakes(app, { validTokens: null, broker: 'ok' })
  await notionCard(page).getByRole('button', { name: 'Reconectar com Notion' }).click()
  await expect(notionCard(page).getByText('Grace Hopper', { exact: true }).first()).toBeVisible()
  await expect(alerts(notionCard(page))).toHaveCount(0)
})

test('desconectar apaga os tokens do disco', async () => {
  const { page } = orkio!
  await notionCard(page).getByRole('button', { name: 'Desconectar' }).click()
  await page
    .getByRole('group', { name: 'Confirmar desconexão' })
    .getByRole('button', { name: 'Desconectar' })
    .click()
  await expect(notionCard(page).getByRole('button', { name: 'Conectar com Notion' })).toBeVisible()
  expect(secretFiles()).toEqual([])
})

test('usuário recusa no Notion → mensagem clara e nada salvo', async () => {
  const { app, page } = orkio!
  await setFakes(app, { browser: 'deny' })
  await notionCard(page).getByRole('button', { name: 'Conectar com Notion' }).click()

  await expect(alerts(notionCard(page))).toContainText('Você não autorizou o acesso')
  expect(secretFiles()).toEqual([])
})

test('cancelar enquanto aguarda o navegador volta ao início e libera a porta', async () => {
  const { app, page } = orkio!
  await setFakes(app, { browser: 'ignore' })
  await notionCard(page).getByRole('button', { name: 'Tentar novamente' }).click()

  await expect(notionCard(page).getByText('Aguardando autorização no Notion…')).toBeVisible()
  await shot(page, 'oauth-4-aguardando')
  await notionCard(page).getByRole('button', { name: 'Cancelar' }).click()
  await expect(
    notionCard(page).getByRole('button', { name: /Conectar com Notion|Tentar novamente/ })
  ).toBeVisible()
  expect(secretFiles()).toEqual([])

  // A porta local foi liberada: um novo login funciona.
  await setFakes(app, { browser: 'approve' })
  await notionCard(page)
    .getByRole('button', { name: /Conectar com Notion|Tentar novamente/ })
    .click()
  await expect(notionCard(page).getByText('Grace Hopper', { exact: true }).first()).toBeVisible()
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('nenhum token ou code OAuth aparece nos logs', () => {
  const logs = allLogs.join('\n')
  expect(logs).not.toMatch(/ntn_E2E_OAUTH|nrt_E2E_OAUTH|e2e-auth-code/)
  expect(logs).not.toMatch(/Content Security Policy/)
})

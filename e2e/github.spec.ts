import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createUserDataDir,
  cspViolations,
  externalCalls,
  githubCard,
  launchOrkio,
  openIntegration,
  openedUrls,
  removeDir,
  setFakes,
  type FakeServices,
  type OrkioApp,
  alerts
} from './fixtures'

const PAT = 'github_pat_E2E_SECRET_TOKEN_0123456789'

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
  await openIntegration(orkio.page, 'GitHub')
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

test('Device Flow: mostra o código, copia, abre o GitHub e conecta ao autorizar', async () => {
  const { app, page } = await open({ githubDevice: 'pending' })
  const card = githubCard(page)
  await expect(card.getByText('Desconectado')).toBeVisible()
  // Lista de integrações: a linha do GitHub diz o estado; sem conexão, o card já vem aberto nela.
  const row = page.getByRole('article', { name: 'GitHub', exact: true })
  await expect(row).toContainText('Não conectado')
  await expect(row.getByRole('button', { name: 'Fechar GitHub' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'GitHub' })).toBeVisible()
  await shot(page, 'github-1-desconectado')

  await card.getByRole('button', { name: 'Conectar com GitHub' }).click()

  // Código grande em mono, contagem regressiva e ações.
  const code = card.locator('[data-testid="device-code"]')
  await expect(code).toHaveText('WDJB-MJHT')
  expect(await code.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(card.getByRole('timer')).toContainText(/expira em 1[45]:\d\d/)
  await shot(page, 'github-2-codigo')

  await card.getByRole('button', { name: 'Copiar' }).click()
  await expect(card.getByRole('button', { name: 'Copiado' })).toBeVisible()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('WDJB-MJHT')

  await card.getByRole('button', { name: /Abrir GitHub/ }).click()
  await expect.poll(() => openedUrls(app)).toContain('https://github.com/login/device')

  // O usuário autoriza no GitHub: o polling no main conecta sozinho.
  await setFakes(app, { githubDevice: 'approve' })
  await expect(card.getByText('The Octocat', { exact: true }).first()).toBeVisible({
    timeout: 15_000
  })
  await expect(card.getByText(/@octocat/)).toBeVisible()
  await expect(row).toContainText('Conectado como octocat')
  // A linha continua aberta depois de conectar (a confirmação não some na hora).
  await expect(row.getByRole('button', { name: 'Fechar GitHub' })).toBeVisible()
  await shot(page, 'github-3-conectado')

  // Requisições: Device Flow sem client secret e API com a versão certa.
  const calls = await externalCalls(app)
  const deviceCode = calls.find((c) => c.url === 'https://github.com/login/device/code')
  expect(JSON.parse(deviceCode!.body!)).toEqual({ client_id: 'e2e-github-client', scope: 'repo' })
  const polls = calls.filter((c) => c.url === 'https://github.com/login/oauth/access_token')
  expect(polls.length).toBeGreaterThanOrEqual(1)
  expect(JSON.parse(polls[0]!.body!)).toEqual({
    client_id: 'e2e-github-client',
    device_code: 'e2e-device-code',
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  })
  expect(JSON.stringify(calls)).not.toMatch(/secret/i)
  const user = calls.find((c) => c.url === 'https://api.github.com/user')
  expect(user).toMatchObject({ auth: 'Bearer gho_E2E_DEVICE_TOKEN', version: '2026-03-10' })

  // Token cifrado no disco e fora do renderer.
  expect(secretFiles()).toContain('github.bin')
  const raw = readFileSync(join(userDataDir, 'secrets', 'github.bin'))
  expect(raw.includes('gho_E2E')).toBe(false)
  const status = await page.evaluate(() => window.orkio.github.getStatus())
  expect(JSON.stringify(status)).not.toContain('gho_')
  await close()
})

test('reabrir o app mantém a conexão do GitHub', async () => {
  const { page } = await open()
  const card = githubCard(page)
  await expect(card.getByText('The Octocat', { exact: true }).first()).toBeVisible()
  await expect(card.getByText(/Verificado às/)).toBeVisible()
})

test('rate limit primário ao testar → continua conectado com aviso', async () => {
  const { app, page } = orkio!
  const card = githubCard(page)
  await setFakes(app, { githubUser: 'rate_limited' })
  await card.getByRole('button', { name: 'Testar conexão' }).click()
  await expect(
    card.getByRole('status').filter({ hasText: 'Limite de requisições do GitHub' })
  ).toBeVisible()
  await expect(card.getByText('The Octocat', { exact: true }).first()).toBeVisible()
  await setFakes(app, { githubUser: 'ok' })
})

test('desconectar apaga a credencial do disco', async () => {
  const { page } = orkio!
  const card = githubCard(page)
  await card.getByRole('button', { name: 'Desconectar' }).click()
  await card
    .getByRole('group', { name: 'Confirmar desconexão' })
    .getByRole('button', { name: 'Desconectar' })
    .click()
  await expect(card.getByRole('button', { name: 'Conectar com GitHub' })).toBeVisible()
  expect(secretFiles()).not.toContain('github.bin')
})

test('usuário recusa no GitHub → mensagem clara e nada salvo', async () => {
  const { app, page } = orkio!
  const card = githubCard(page)
  await setFakes(app, { githubDevice: 'deny' })
  await card.getByRole('button', { name: 'Conectar com GitHub' }).click()
  await expect(alerts(card)).toContainText('Você cancelou a autorização no GitHub')
  expect(secretFiles()).not.toContain('github.bin')
})

test('código expirado → mensagem para gerar outro', async () => {
  const { app, page } = orkio!
  const card = githubCard(page)
  await setFakes(app, { githubDevice: 'expire' })
  await card.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(alerts(card)).toContainText('O código expirou')
})

test('cancelar o Device Flow volta ao início sem salvar nada', async () => {
  const { app, page } = orkio!
  const card = githubCard(page)
  await setFakes(app, { githubDevice: 'pending' })
  await card.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(card.locator('[data-testid="device-code"]')).toHaveText('WDJB-MJHT')
  await card.getByRole('button', { name: 'Cancelar' }).click()
  await expect(card.locator('[data-testid="device-code"]')).toHaveCount(0)
  await expect(
    card.getByRole('button', { name: /Conectar com GitHub|Tentar novamente/ })
  ).toBeVisible()
  expect(secretFiles()).not.toContain('github.bin')
})

test('token colado: inválido mostra erro e não salva; válido conecta', async () => {
  const { app, page } = orkio!
  const card = githubCard(page)
  await card.getByRole('button', { name: 'Usar token' }).click()
  const input = card.getByLabel('Token do GitHub')
  await expect(input).toHaveAttribute('type', 'password')

  await setFakes(app, { githubUser: '401' })
  await input.fill(PAT)
  await card.getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(alerts(card)).toContainText('inválido, expirado ou revogado')
  expect(secretFiles()).not.toContain('github.bin')
  await shot(page, 'github-4-token-invalido')

  await setFakes(app, { githubUser: 'ok' })
  await card.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(card.getByText('The Octocat', { exact: true }).first()).toBeVisible()
  expect(secretFiles()).toContain('github.bin')
  expect(readFileSync(join(userDataDir, 'secrets', 'github.bin')).includes(PAT)).toBe(false)
  expect(await cspViolations(page)).toEqual([])
  await close()
})

test('nenhum token do GitHub aparece nos logs', () => {
  const logs = allLogs.join('\n')
  expect(logs).not.toContain(PAT)
  expect(logs).not.toMatch(/gho_E2E|e2e-device-code/)
  expect(logs).not.toMatch(/Content Security Policy/)
})

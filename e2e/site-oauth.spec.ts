import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createUserDataDir,
  launchOrkio,
  notionCard,
  removeDir,
  setFakes,
  alerts,
  type OrkioApp
} from './fixtures'

/**
 * Etapa 6A: o app (build E2E) faz o login OAuth do Notion passando pelo SITE de verdade
 * (`next start` do site/), que fala com um Notion simulado em HTTP local. Prova o contrato
 * app ↔ site ↔ Notion sem tocar no Notion real. Precisa do build do site:
 *   pnpm --dir site build
 * No CI, roda no workflow do site (tag @site).
 */
const SITE = resolve(__dirname, '..', 'site')
const CLIENT_ID = 'e2e-client-id'
const CLIENT_SECRET = 'secret_E2E_SITE_NUNCA_NO_APP'
const REDIRECT_URI = 'http://localhost:47821/oauth/notion/callback'

test.describe.configure({ mode: 'serial' })
test.skip(
  !existsSync(join(SITE, '.next', 'BUILD_ID')),
  'Build do site ausente: rode `pnpm --dir site build` antes (no CI: workflow do site).'
)

let userDataDir: string
let orkio: OrkioApp | null = null
let notion: Server
let site: ChildProcess
let siteUrl = ''
const siteOutput: string[] = []
const grants: { auth: string | undefined; body: Record<string, unknown> }[] = []

function listen(server: Server): Promise<number> {
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port))
  )
}

async function freePort(): Promise<number> {
  const s = createServer()
  const port = await listen(s)
  await new Promise<void>((r) => s.close(() => r()))
  return port
}

test.beforeAll(async () => {
  userDataDir = createUserDataDir()
  // Notion simulado: só o endpoint de token (o resto da API segue simulado dentro do app).
  let seq = 0
  notion = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      grants.push({ auth: req.headers['authorization'], body })
      seq++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          access_token: `ntn_E2E_OAUTH_ACCESS_${seq}`,
          token_type: 'bearer',
          refresh_token: `nrt_E2E_OAUTH_REFRESH_${seq}`,
          bot_id: 'bot-e2e',
          workspace_id: 'ws-e2e',
          workspace_name: 'Acme Labs',
          workspace_icon: null,
          owner: { type: 'user', user: { id: 'u1', name: 'Grace Hopper', avatar_url: null } },
          request_id: 'campo-que-o-site-nao-repassa'
        })
      )
    })
  })
  const notionPort = await listen(notion)

  const port = await freePort()
  siteUrl = `http://127.0.0.1:${port}`
  site = spawn(
    process.execPath,
    [
      join(SITE, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-H',
      '127.0.0.1',
      '-p',
      String(port)
    ],
    {
      cwd: SITE,
      env: {
        PATH: process.env['PATH'] ?? '',
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        NOTION_CLIENT_ID: CLIENT_ID,
        NOTION_CLIENT_SECRET: CLIENT_SECRET,
        ALLOWED_REDIRECT_URIS: REDIRECT_URI,
        NOTION_TOKEN_URL: `http://127.0.0.1:${notionPort}/v1/oauth/token`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  site.stdout?.on('data', (d: Buffer) => siteOutput.push(String(d)))
  site.stderr?.on('data', (d: Buffer) => siteOutput.push(String(d)))
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${siteUrl}/health`)).status
        } catch {
          return 0
        }
      },
      { timeout: 30_000 }
    )
    .toBe(200)
})

test.afterAll(async () => {
  if (orkio) await orkio.app.close()
  site?.kill('SIGTERM')
  await new Promise<void>((r) => (notion ? notion.close(() => r()) : r()))
  removeDir(userDataDir)
})

test('@site login OAuth do Notion pelo site local (troca do código e renovação)', async () => {
  orkio = await launchOrkio(userDataDir, { brokerTarget: siteUrl })
  const { app, page } = orkio

  await notionCard(page).getByRole('button', { name: 'Conectar com Notion' }).click()
  await expect(notionCard(page).getByText('Grace Hopper', { exact: true }).first()).toBeVisible()
  await expect(notionCard(page).getByText(/Acme Labs/)).toBeVisible()

  // O site trocou o código no "Notion" com HTTP Basic (client_id:secret), que o app nunca viu.
  const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
  expect(grants[0]).toEqual({
    auth: basic,
    body: { grant_type: 'authorization_code', code: 'e2e-auth-code', redirect_uri: REDIRECT_URI }
  })

  // Token expirado → o app renova pelo site.
  await setFakes(app, { validTokens: ['ntn_E2E_OAUTH_ACCESS_2'] })
  await notionCard(page).getByRole('button', { name: 'Testar conexão' }).click()
  await expect(notionCard(page).getByText(/Verificado às/)).toBeVisible()
  await expect(alerts(notionCard(page))).toHaveCount(0)
  expect(grants[1]).toEqual({
    auth: basic,
    body: { grant_type: 'refresh_token', refresh_token: 'nrt_E2E_OAUTH_REFRESH_1' }
  })

  // Nada de segredo/token/código nos logs do site nem do app.
  const logs = [...siteOutput, ...orkio.logs].join('\n')
  for (const secret of [CLIENT_SECRET, 'ntn_E2E_OAUTH', 'nrt_E2E_OAUTH', 'e2e-auth-code']) {
    expect(logs).not.toContain(secret)
  }
  const status = await page.evaluate(() => window.orkio.notion.getStatus())
  expect(JSON.stringify(status)).not.toMatch(/E2E_OAUTH|campo-que-o-site/)
})

test('@site redirect fora da lista é recusado pelo site (sem chamar o Notion)', async () => {
  const before = grants.length
  const res = await fetch(`${siteUrl}/notion/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'x', redirect_uri: 'https://evil.example/cb' })
  })
  expect(res.status).toBe(400)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(grants.length).toBe(before)
})

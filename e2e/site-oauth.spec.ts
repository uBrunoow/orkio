import { spawn, type ChildProcess } from 'node:child_process'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createUserDataDir,
  launchOrkio,
  notionCard,
  openIntegration,
  removeDir,
  setFakes,
  alerts,
  type OrkioApp
} from './fixtures'
import { NOTION_OAUTH_REDIRECT_URI as REDIRECT_URI } from '../src/shared/site-contract'

/**
 * Etapa 6A: o app (build E2E) faz o login OAuth do Notion passando pelo SITE de verdade
 * (`next start` do site/), que fala com um Notion simulado em HTTP local. Prova o contrato
 * app ↔ site ↔ Notion sem tocar no Notion real. Precisa do build do site:
 *   pnpm --dir site build
 * No CI, roda no workflow do site (tag @site) e falha se o build faltar; localmente, sem o build,
 * pula com aviso.
 */
const SITE = resolve(__dirname, '..', 'site')
const CLIENT_ID = 'e2e-client-id'
const CLIENT_SECRET = 'secret_E2E_SITE_NUNCA_NO_APP'
const SITE_BUILT = existsSync(join(SITE, '.next', 'BUILD_ID'))
const NO_BUILD = 'Build do site ausente: rode `pnpm --dir site build` antes.'

test.describe.configure({ mode: 'serial' })
// Só local: no CI o teste do contrato app ↔ site nunca pula em silêncio (o beforeAll falha).
test.skip(!SITE_BUILT && !process.env['CI'], NO_BUILD)
if (!SITE_BUILT && !process.env['CI']) console.warn(`[@site] pulado: ${NO_BUILD}`)

let userDataDir: string
let orkio: OrkioApp | null = null
let notion: Server
let site: ChildProcess
let siteUrl = ''
const siteOutput: string[] = []
const grants: { auth: string | undefined; body: Record<string, unknown> }[] = []

// GitHub App (revisão como orkio[bot]): chave de teste e GitHub simulado em HTTP local.
const APP_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const APP_PEM = APP_KEY.export({ type: 'pkcs8', format: 'pem' }).toString()
const USER_TOKEN = 'gho_E2E_USUARIO_REVIEW'
const APP_TOKEN = 'ghs_E2E_APP_REVIEW'
let github: Server
const githubCalls: { method: string; path: string; auth: string; body: unknown }[] = []

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
  if (!SITE_BUILT) throw new Error(NO_BUILD)
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

  github = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString()))
    req.on('end', () => {
      const path = req.url ?? ''
      const auth = String(req.headers['authorization'] ?? '')
      githubCalls.push({ method: req.method ?? '', path, auth, body: raw ? JSON.parse(raw) : null })
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (path === '/repos/acme/orkio' && auth === `Bearer ${USER_TOKEN}`) {
        return send(200, { name: 'orkio', owner: { login: 'acme' }, permissions: { push: true } })
      }
      if (path === '/user' && auth === `Bearer ${USER_TOKEN}`) {
        return send(200, { login: 'grace-e2e', id: 1 })
      }
      if (path === '/repos/acme/sem-push' && auth === `Bearer ${USER_TOKEN}`) {
        return send(200, {
          name: 'sem-push',
          owner: { login: 'acme' },
          permissions: { push: false }
        })
      }
      if (path === '/repos/acme/orkio/installation' && validJwt(auth)) return send(200, { id: 7 })
      if (path === '/app/installations/7/access_tokens' && validJwt(auth)) {
        return send(201, { token: APP_TOKEN, expires_at: '2030-01-01T00:00:00Z' })
      }
      if (path === '/repos/acme/orkio/pulls/7/reviews' && auth === `Bearer ${APP_TOKEN}`) {
        return send(200, {
          id: 99,
          html_url: 'https://github.com/acme/orkio/pull/7#pullrequestreview-99'
        })
      }
      send(404, { message: 'Not Found' })
    })
  })
  const githubPort = await listen(github)

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
        NOTION_TOKEN_URL: `http://127.0.0.1:${notionPort}/v1/oauth/token`,
        GITHUB_APP_ID: '424242',
        // Como na Vercel: uma linha só, com "\n" literais.
        GITHUB_APP_PRIVATE_KEY: APP_PEM.replace(/\n/g, '\\n'),
        GITHUB_APP_SLUG: 'orkio-e2e',
        GITHUB_API_URL: `http://127.0.0.1:${githubPort}`
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
  await new Promise<void>((r) => (github ? github.close(() => r()) : r()))
  removeDir(userDataDir)
})

test('@site login OAuth do Notion pelo site local (troca do código e renovação)', async () => {
  orkio = await launchOrkio(userDataDir, { siteTarget: siteUrl })
  const { app, page } = orkio

  await notionCard(page).getByRole('button', { name: 'Conectar com Notion' }).click()
  // Conectado, o card da grade fecha os detalhes: o resumo mostra a conta; reabre para o resto.
  await expect(
    page.getByRole('article', { name: 'Notion', exact: true }).getByText(/Grace Hopper/)
  ).toBeVisible()
  await openIntegration(page, 'Notion')
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

/** JWT RS256 do App assinado com a chave de teste, iss = App ID, validade ≤ 10 min. */
function validJwt(auth: string): boolean {
  const [h, p, sig] = auth.replace(/^Bearer /, '').split('.')
  if (!h || !p || !sig) return false
  const ok = verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    createPublicKey(APP_KEY),
    Buffer.from(sig, 'base64url')
  )
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, number>
  return ok && String(claims['iss']) === '424242' && claims['exp']! - claims['iat']! <= 600
}

test('@site revisão como orkio[bot]: o site confere o push e posta; o token do App não sai', async () => {
  const ask = (body: unknown): Promise<Response> =>
    fetch(`${siteUrl}/github/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  const request = (event: unknown, repo = 'orkio') => ({
    owner: 'acme',
    repo,
    number: 7,
    userToken: USER_TOKEN,
    review: {
      event,
      body: 'Faltam testes.',
      comments: [{ path: 'src/a.ts', line: 3, body: 'Trate o erro.' }]
    }
  })

  // APPROVE nunca chega ao GitHub.
  const approve = await ask(request('APPROVE'))
  expect(approve.status).toBe(400)
  expect(githubCalls).toHaveLength(0)

  const ok = await ask(request('REQUEST_CHANGES'))
  expect(ok.status).toBe(200)
  expect(ok.headers.get('cache-control')).toBe('no-store')
  const text = await ok.text()
  expect(JSON.parse(text)).toEqual({
    url: 'https://github.com/acme/orkio/pull/7#pullrequestreview-99'
  })
  for (const secret of [APP_TOKEN, USER_TOKEN, 'eyJ', 'PRIVATE KEY']) {
    expect(text).not.toContain(secret)
  }
  const tokenCall = githubCalls.find((c) => c.path === '/app/installations/7/access_tokens')
  expect(tokenCall?.body).toEqual({
    repositories: ['orkio'],
    permissions: { pull_requests: 'write' }
  })
  const reviewCall = githubCalls.find((c) => c.path === '/repos/acme/orkio/pulls/7/reviews')
  expect(reviewCall?.body).toEqual({
    event: 'REQUEST_CHANGES',
    body: 'Faltam testes.\n\n---\n_Publicado pelo Orkio a pedido de @grace-e2e._',
    comments: [{ path: 'src/a.ts', line: 3, side: 'RIGHT', body: 'Trate o erro.' }]
  })

  const noPush = await ask(request('COMMENT', 'sem-push'))
  expect(noPush.status).toBe(403)
  expect(await noPush.json()).toEqual({ error: 'forbidden' })

  expect((await ask({ ...request('COMMENT'), owner: '../acme' })).status).toBe(400)
  expect((await fetch(`${siteUrl}/github/review`)).status).toBe(405)
  expect((await fetch(`${siteUrl}/github/review-token`, { method: 'POST' })).status).toBe(404)

  const logs = siteOutput.join('\n')
  for (const secret of [USER_TOKEN, APP_TOKEN, 'PRIVATE KEY', 'Faltam testes']) {
    expect(logs).not.toContain(secret)
  }
})

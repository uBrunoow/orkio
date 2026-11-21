/**
 * Smoke test do app empacotado (Etapa 6B). Prova, no binário que vai para o usuário:
 * 1. o app abre e chega à tela inicial, sem violação de CSP, e fecha;
 * 2. a ponte MCP de permissões (out/main/permission-mcp.js, dentro do app.asar) roda com
 *    ELECTRON_RUN_AS_NODE=1 e faz initialize → tools/list → tools/call ida e volta. Isso também
 *    prova que o fuse RunAsNode continua ligado (desligado, o executável abriria o app).
 *
 * Sem Playwright `_electron`: o fuse EnableNodeCliInspectArguments está desligado no pacote,
 * então abrimos o executável como o usuário abriria e conectamos pelo CDP do Chromium.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { chromium, expect, test } from '@playwright/test'
import { findPackagedApp } from './packaged-app'

const app = findPackagedApp()

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo
      s.close(() => resolve(port))
    })
  })
}

function waitExit(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

test('o app empacotado abre na tela inicial e fecha', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'orkio-smoke-'))
  const port = await freePort()
  const args = [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`]
  // Linux (só no CI): sem o chrome-sandbox SUID, o Chromium precisa de --no-sandbox.
  if (process.platform === 'linux') args.push('--no-sandbox')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  delete env['NODE_OPTIONS']
  const child = spawn(app.executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const logs: string[] = []
  child.stdout?.on('data', (d: Buffer) => logs.push(String(d)))
  child.stderr?.on('data', (d: Buffer) => logs.push(String(d)))
  try {
    const browser = await connectWithRetry(`http://127.0.0.1:${port}`, child, logs)
    const page = await expect
      .poll(() => browser.contexts().flatMap((c) => c.pages()).length, { timeout: 30_000 })
      .toBeGreaterThan(0)
      .then(() => browser.contexts().flatMap((c) => c.pages())[0]!)
    await page.addInitScript(() => {
      const w = window as unknown as { __csp: string[] }
      w.__csp = []
      document.addEventListener('securitypolicyviolation', (e) =>
        w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)
      )
    })
    await page.reload()
    // Instalação nova e sem GitHub conectado: o app abre no login e só depois mostra o checklist.
    await expect(page.getByText('Entrar no Orkio')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar sem GitHub' }).click()
    await expect(page.getByText('Vamos começar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Começar', exact: true })).toBeVisible()
    // Renderer isolado também no pacote.
    expect(await page.evaluate(() => typeof (window as { require?: unknown }).require)).toBe(
      'undefined'
    )
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([])
    await browser.close().catch(() => undefined)
  } finally {
    child.kill()
    await waitExit(child, 15_000)
    rmSync(userData, { recursive: true, force: true })
  }
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
})

async function connectWithRetry(url: string, child: ChildProcess, logs: string[]) {
  const deadline = Date.now() + 45_000
  let last: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`O app fechou sozinho (código ${child.exitCode}).\n${logs.join('')}`)
    }
    try {
      return await chromium.connectOverCDP(url, { timeout: 5_000 })
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`Não conectei ao app empacotado: ${String(last)}\n${logs.join('')}`)
}

/** Socket local no lugar do processo main: responde "allow" e registra o pedido. */
function fakeOrkio(token: string): Promise<{ server: Server; path: string; requests: unknown[] }> {
  const path =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\orkio-smoke-${randomUUID()}`
      : join(mkdtempSync(join(tmpdir(), 'orkio-sock-')), 'bridge.sock')
  const requests: unknown[] = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      const req = JSON.parse(buffer.slice(0, nl)) as { token?: string }
      requests.push(req)
      const ok = req.token === token
      socket.end(
        `${JSON.stringify(ok ? { behavior: 'allow' } : { behavior: 'deny', message: 'token' })}\n`
      )
    })
  })
  return new Promise((resolve) => server.listen(path, () => resolve({ server, path, requests })))
}

test('a ponte MCP de permissões roda de dentro do app.asar', async () => {
  const script = join(app.resources, 'app.asar', 'out', 'main', 'permission-mcp.js')
  expect(existsSync(join(app.resources, 'app.asar'))).toBe(true)
  const token = randomUUID()
  const orkio = await fakeOrkio(token)
  // Mesmo formato do mcp-config que o runner escreve (src/main/claude/runner.ts).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: '',
    ELECTRON_RUN_AS_NODE: '1',
    ORKIO_BRIDGE_SOCKET: orkio.path,
    ORKIO_BRIDGE_TOKEN: token
  }
  const child = spawn(app.executable, [script], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => (stderr += String(d)))
  const replies = new Map<number, Record<string, unknown>>()
  const waiters = new Map<number, (v: Record<string, unknown>) => void>()
  createInterface({ input: child.stdout! }).on('line', (line) => {
    const msg = JSON.parse(line) as { id: number } & Record<string, unknown>
    replies.set(msg.id, msg)
    waiters.get(msg.id)?.(msg)
  })
  const call = (id: number, method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Sem resposta para ${method}. stderr: ${stderr}`)),
        20_000
      )
      waiters.set(id, (v) => {
        clearTimeout(timer)
        resolve(v)
      })
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  try {
    const init = await call(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1' }
    })
    expect(init['result']).toMatchObject({ serverInfo: { name: 'orkio' } })
    const list = await call(2, 'tools/list')
    expect(JSON.stringify(list['result'])).toContain('"approve"')
    const res = await call(3, 'tools/call', {
      name: 'approve',
      arguments: { tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 't1' }
    })
    expect(res['result']).toEqual({ content: [{ type: 'text', text: '{"behavior":"allow"}' }] })
    expect(orkio.requests).toEqual([
      { token, toolName: 'Bash', input: { command: 'ls' }, toolUseId: 't1' }
    ])
  } finally {
    child.stdin?.end()
    child.kill()
    await waitExit(child, 5_000)
    orkio.server.close()
  }
})

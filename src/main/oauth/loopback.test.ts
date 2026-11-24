import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoopbackAuthError, authorizeViaLoopback, parseRedirectUri } from './loopback'

const STATE = 'state-fixo-para-teste'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((r) => server.close(() => r()))
  return port
}

/** GET simples que permite trocar o header Host. */
function get(url: string, host?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers: host ? { Host: host } : {} }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

let blocker: Server | null = null
afterEach(async () => {
  if (blocker) await new Promise<void>((r) => blocker!.close(() => r()))
  blocker = null
})

async function setup(overrides: Partial<Parameters<typeof authorizeViaLoopback>[0]> = {}) {
  const port = await freePort()
  const redirectUri = `http://127.0.0.1:${port}/oauth/test/callback`
  let authorizeUrl = ''
  const opened = new Promise<string>((resolve) => {
    overrides.openExternal ??= async (url: string) => {
      authorizeUrl = url
      resolve(url)
    }
  })
  const flow = authorizeViaLoopback({
    redirectUri,
    providerName: 'Notion',
    timeoutMs: 5_000,
    randomState: () => STATE,
    buildAuthorizeUrl: (state) => `https://provider.example/authorize?state=${state}`,
    openExternal: overrides.openExternal!,
    ...overrides
  })
  return { port, redirectUri, flow, opened, authorizeUrl: () => authorizeUrl }
}

describe('authorizeViaLoopback', () => {
  it('abre o navegador com o state e devolve o code do redirect', async () => {
    const { redirectUri, flow, opened } = await setup()
    expect(await opened).toBe(`https://provider.example/authorize?state=${STATE}`)

    const res = await get(`${redirectUri}?code=abc123&state=${STATE}`)
    expect(res.status).toBe(200)
    expect(res.body).toContain('Pode fechar esta aba')
    expect(res.body).not.toContain('abc123')
    await expect(flow).resolves.toEqual({ code: 'abc123' })

    // Servidor encerrado depois do login (fecha logo depois de responder).
    await expect
      .poll(() =>
        get(`${redirectUri}?code=x&state=${STATE}`).then(
          () => 'aberto',
          () => 'fechado'
        )
      )
      .toBe('fechado')
  })

  it('state diferente → 400 e continua aguardando o redirect certo', async () => {
    const { redirectUri, flow, opened } = await setup()
    await opened
    const bad = await get(`${redirectUri}?code=evil&state=outro`)
    expect(bad.status).toBe(400)

    await get(`${redirectUri}?code=bom&state=${STATE}`)
    await expect(flow).resolves.toEqual({ code: 'bom' })
  })

  it('rota errada → 404; Host estranho (DNS rebinding) → 400', async () => {
    const { port, redirectUri, flow, opened } = await setup()
    await opened
    expect((await get(`http://127.0.0.1:${port}/outra?code=x&state=${STATE}`)).status).toBe(404)
    expect((await get(`${redirectUri}?code=x&state=${STATE}`, 'evil.example:80')).status).toBe(400)

    await get(`${redirectUri}?code=ok&state=${STATE}`)
    await expect(flow).resolves.toEqual({ code: 'ok' })
  })

  it('usuário recusa (access_denied) → erro access_denied', async () => {
    const { redirectUri, flow, opened } = await setup()
    const outcome = flow.catch((e: unknown) => e)
    await opened
    const res = await get(`${redirectUri}?error=access_denied&state=${STATE}`)
    expect(res.body).toContain('Autorização cancelada')
    expect(await outcome).toMatchObject({ code: 'access_denied' })
  })

  it('outro erro do provedor → provider_error', async () => {
    const { redirectUri, flow, opened } = await setup()
    const outcome = flow.catch((e: unknown) => e)
    await opened
    await get(`${redirectUri}?error=server_error&state=${STATE}`)
    expect(await outcome).toMatchObject({ code: 'provider_error' })
  })

  it('tempo esgotado → timeout e porta liberada', async () => {
    const { port, flow } = await setup({ timeoutMs: 50 })
    await expect(flow).rejects.toMatchObject({ code: 'timeout' })
    // A porta volta a ficar livre (o fechamento termina logo depois do timeout).
    await vi.waitFor(async () => {
      const server = createServer()
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', resolve)
      })
      blocker = server
    })
  })

  it('cancelar via AbortSignal → cancelled', async () => {
    const controller = new AbortController()
    const { flow, opened } = await setup({ signal: controller.signal })
    await opened
    controller.abort()
    await expect(flow).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('porta ocupada → port_in_use com mensagem acionável', async () => {
    const port = await freePort()
    blocker = createServer()
    await new Promise<void>((r) => blocker!.listen(port, '127.0.0.1', r))
    const openExternal = vi.fn(async () => {})

    const error = await authorizeViaLoopback({
      redirectUri: `http://127.0.0.1:${port}/cb`,
      providerName: 'Notion',
      timeoutMs: 1_000,
      buildAuthorizeUrl: () => 'https://provider.example/authorize',
      openExternal
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LoopbackAuthError)
    expect(error).toMatchObject({ code: 'port_in_use' })
    expect((error as Error).message).toContain(String(port))
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('falha ao abrir o navegador → browser_failed', async () => {
    const { flow } = await setup({
      openExternal: async () => {
        throw new Error('sem navegador')
      }
    })
    await expect(flow).rejects.toMatchObject({ code: 'browser_failed' })
  })

  it('redirect URI inválida → invalid_config', async () => {
    for (const uri of [
      'https://127.0.0.1:1/cb',
      'http://example.com:1/cb',
      'http://127.0.0.1/cb',
      'lixo'
    ]) {
      await expect(
        authorizeViaLoopback({
          redirectUri: uri,
          providerName: 'X',
          timeoutMs: 1,
          buildAuthorizeUrl: () => '',
          openExternal: async () => {}
        })
      ).rejects.toMatchObject({ code: 'invalid_config' })
    }
  })
})

describe('parseRedirectUri', () => {
  it('aceita loopback http com porta', () => {
    expect(parseRedirectUri('http://127.0.0.1:47821/oauth/notion/callback')).toEqual({
      port: 47821,
      path: '/oauth/notion/callback',
      host: '127.0.0.1:47821',
      listenHost: '127.0.0.1'
    })
    expect(parseRedirectUri('http://localhost:47821/cb')?.host).toBe('localhost:47821')
  })
})

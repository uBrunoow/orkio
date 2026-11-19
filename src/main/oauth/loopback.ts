import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * Fluxo OAuth 2.0 para apps nativos com redirect em loopback (RFC 8252 §7.3).
 *
 * 1. Sobe um servidor HTTP em 127.0.0.1, só durante o login.
 * 2. Abre a página de autorização no navegador padrão, com um `state` aleatório.
 * 3. Recebe `?code=...&state=...` no redirect, confere o `state` e devolve o `code`.
 *
 * O `code` sozinho não dá acesso a nada: ainda precisa ser trocado (no nosso caso, pelo
 * intermediário que guarda o client_secret). Nada aqui é logado.
 */

export type LoopbackErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'port_in_use'
  | 'access_denied'
  | 'provider_error'
  | 'browser_failed'
  | 'invalid_config'

export class LoopbackAuthError extends Error {
  constructor(
    readonly code: LoopbackErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LoopbackAuthError'
  }
}

export interface LoopbackAuthorizeOptions {
  /** Ex.: http://127.0.0.1:47821/oauth/notion/callback — precisa estar registrado no provedor. */
  redirectUri: string
  buildAuthorizeUrl(state: string): string
  openExternal(url: string): Promise<void>
  timeoutMs: number
  signal?: AbortSignal
  /** Nome do serviço exibido na página de retorno (ex.: "Notion"). */
  providerName: string
  randomState?: () => string
}

export interface LoopbackResult {
  code: string
}

export function authorizeViaLoopback(options: LoopbackAuthorizeOptions): Promise<LoopbackResult> {
  const target = parseRedirectUri(options.redirectUri)
  if (!target) {
    return Promise.reject(
      new LoopbackAuthError('invalid_config', 'Configuração de login inválida neste build.')
    )
  }
  if (options.signal?.aborted) {
    return Promise.reject(new LoopbackAuthError('cancelled', 'Conexão cancelada.'))
  }

  const state = (options.randomState ?? defaultState)()
  const { providerName } = options

  return new Promise<LoopbackResult>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const server = createServer((req, res) => {
      const outcome = handleCallback(req, target, state)
      sendPage(res, outcome.httpStatus, outcome.page(providerName))
      if (outcome.kind === 'code') finish(null, { code: outcome.code })
      if (outcome.kind === 'fail') finish(outcome.error)
      // 'ignore': requisição inválida (state errado, outra rota): segue aguardando.
    })

    const onAbort = (): void => finish(new LoopbackAuthError('cancelled', 'Conexão cancelada.'))

    function finish(error: LoopbackAuthError | null, result?: LoopbackResult): void {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      // Fecha depois de a resposta sair, e derruba conexões keep-alive.
      setImmediate(() => {
        server.close()
        server.closeAllConnections()
      })
      if (error) reject(error)
      else resolve(result!)
    }

    server.on('error', (err: NodeJS.ErrnoException) => {
      finish(
        err.code === 'EADDRINUSE'
          ? new LoopbackAuthError(
              'port_in_use',
              `A porta ${target.port} está sendo usada por outro programa. Feche-o e tente de novo.`
            )
          : new LoopbackAuthError('browser_failed', 'Não foi possível iniciar o login.')
      )
    })

    options.signal?.addEventListener('abort', onAbort, { once: true })

    server.listen(target.port, target.listenHost, () => {
      if (settled) return
      timer = setTimeout(
        () =>
          finish(
            new LoopbackAuthError(
              'timeout',
              `O tempo para autorizar no ${providerName} acabou. Tente conectar de novo.`
            )
          ),
        options.timeoutMs
      )
      options
        .openExternal(options.buildAuthorizeUrl(state))
        .catch(() =>
          finish(
            new LoopbackAuthError(
              'browser_failed',
              'Não foi possível abrir o navegador. Verifique seu navegador padrão e tente de novo.'
            )
          )
        )
    })
  })
}

interface RedirectTarget {
  port: number
  path: string
  /** Valor esperado no header Host (proteção contra DNS rebinding). */
  host: string
  listenHost: string
}

export function parseRedirectUri(uri: string): RedirectTarget | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || url.port === '' || url.search || url.hash) return null
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null
  return {
    port: Number(url.port),
    path: url.pathname,
    host: url.host,
    listenHost: '127.0.0.1'
  }
}

type CallbackOutcome =
  | { kind: 'code'; code: string; httpStatus: 200; page: (provider: string) => string }
  | { kind: 'fail'; error: LoopbackAuthError; httpStatus: number; page: (p: string) => string }
  | { kind: 'ignore'; httpStatus: number; page: (provider: string) => string }

function handleCallback(
  req: IncomingMessage,
  target: RedirectTarget,
  expectedState: string
): CallbackOutcome {
  const notFound = {
    kind: 'ignore' as const,
    httpStatus: 404,
    page: () => page('Não encontrado', '')
  }
  if (req.method !== 'GET' || !req.url) return notFound

  const hostHeader = req.headers.host ?? ''
  const allowedHosts = new Set([
    target.host,
    `127.0.0.1:${target.port}`,
    `localhost:${target.port}`
  ])
  if (!allowedHosts.has(hostHeader)) {
    return { kind: 'ignore', httpStatus: 400, page: () => page('Requisição inválida', '') }
  }

  const url = new URL(req.url, `http://${target.host}`)
  if (url.pathname !== target.path) return notFound

  if (url.searchParams.get('state') !== expectedState) {
    return {
      kind: 'ignore',
      httpStatus: 400,
      page: () =>
        page(
          'Link de autorização inválido',
          'Este link é de uma tentativa antiga. Volte ao Orkio e clique em conectar de novo.'
        )
    }
  }

  const providerError = url.searchParams.get('error')
  if (providerError) {
    const denied = providerError === 'access_denied'
    return {
      kind: 'fail',
      httpStatus: 200,
      error: denied
        ? new LoopbackAuthError('access_denied', 'Você não autorizou o acesso. Nada foi conectado.')
        : new LoopbackAuthError(
            'provider_error',
            'O provedor recusou a autorização. Tente de novo.'
          ),
      page: (provider) =>
        page(
          denied ? 'Autorização cancelada' : 'Não foi possível autorizar',
          `Nada foi conectado ao ${provider}. Você pode fechar esta aba e voltar ao Orkio.`
        )
    }
  }

  const code = url.searchParams.get('code')
  if (!code || code.length > 2048) {
    return {
      kind: 'fail',
      httpStatus: 400,
      error: new LoopbackAuthError(
        'provider_error',
        'Resposta de autorização inválida. Tente de novo.'
      ),
      page: () => page('Resposta inválida', 'Volte ao Orkio e tente conectar de novo.')
    }
  }

  return {
    kind: 'code',
    code,
    httpStatus: 200,
    page: (provider) =>
      page(
        `Autorizado no ${provider}`,
        'Pode fechar esta aba e voltar ao Orkio. A conexão termina por lá.'
      )
  }
}

function sendPage(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    // Página estática, sem scripts. Cores espelham os tokens da marca (--bg, --text, --muted).
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
    Connection: 'close'
  })
  res.end(html)
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Orkio — ${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0b;color:#f2f2f0;font:15px/1.5 system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}p{color:#8f8f94}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function defaultState(): string {
  return randomBytes(32).toString('base64url')
}

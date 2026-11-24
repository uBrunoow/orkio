/**
 * Núcleo HTTP dos conectores (Notion, GitHub, site do Orkio e os logins). Roda só no main.
 *
 * - `fetchWithTimeout`: o prazo cobre o pedido E a leitura do corpo (lido com limite de tamanho);
 *   a exceção original nunca sobe (pode carregar detalhes da requisição).
 * - `ApiError`: o erro único, com o serviço (`service`) e um código; a mensagem é segura para o
 *   usuário (pt-BR, sem token nem corpo de resposta).
 * - As mensagens genéricas (tempo, rede, 5xx, inesperado, rate limit) saem de `API_MESSAGES`,
 *   parametrizadas pelo nome do serviço. Cada cliente só mapeia o que é dele (404 por chamada,
 *   rate limit primário/secundário, SSO...).
 */
export type ApiService = 'notion' | 'github' | 'site'

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unexpected'
  /** Nenhuma conta conectada no Orkio (local, sem rede). */
  | 'not_connected'
  /** Recurso não existe ou a conta não tem acesso (404). */
  | 'not_found'
  /** Notion: consulta/conteúdo recusado (400). */
  | 'bad_request'
  /** OAuth do Notion: código ou refresh token inválido, expirado ou revogado (reconectar). */
  | 'invalid_grant'
  /** Login mal configurado nesta versão do app (client ID, Device Flow, intermediário). */
  | 'oauth_config'
  /** GitHub: 403 com X-GitHub-SSO (a org exige autorização SAML para este token). */
  | 'sso_required'
  /** GitHub: restrição de OAuth Apps da org (um owner precisa aprovar o Orkio). */
  | 'oauth_restricted'
  /** Pedido recusado pelo serviço (ex.: 422 do GitHub, login recusado). */
  | 'invalid'
  /** Este build não sabe o endereço do site do Orkio (ou a origem foi recusada). */
  | 'no_site'

/** Dados extras seguros para a UI (ex.: URL de autorização SSO do próprio GitHub). */
export interface ApiErrorDetails {
  ssoUrl?: string
  org?: string
}

/** Erro com mensagem segura para o usuário (pt-BR). Nunca contém o token nem a exceção original. */
export class ApiError extends Error {
  constructor(
    readonly service: ApiService,
    readonly code: ApiErrorCode,
    message: string,
    readonly status?: number,
    readonly details: ApiErrorDetails = {}
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function isApiError(error: unknown, service?: ApiService): error is ApiError {
  return error instanceof ApiError && (service === undefined || error.service === service)
}

const TRANSIENT_CODES: ReadonlySet<ApiErrorCode> = new Set([
  'network',
  'timeout',
  'server',
  'rate_limited',
  'unexpected'
])

/**
 * Falha que pode passar sozinha (rede, tempo, 5xx, rate limit, resposta que não entendemos):
 * não é um veredito sobre a conta ou o recurso. Conexão salva continua conectada (com aviso), o
 * polling do login continua, o projeto fica "não verificado" em vez de "sem acesso".
 */
export function isTransientApiError(error: unknown, service?: ApiService): boolean {
  return isApiError(error, service) && TRANSIENT_CODES.has(error.code)
}

/** Nome de cada serviço nas mensagens (com artigo). */
export const SERVICE_LABELS: Record<ApiService, string> = {
  notion: 'o Notion',
  github: 'o GitHub',
  site: 'o site do Orkio'
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** "em 12 s" / "em 3 min" (a partir de 2 min). */
export function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  return seconds < 120 ? `em ${seconds} s` : `em ${Math.ceil(seconds / 60)} min`
}

/** Mensagens genéricas, iguais para todo serviço (`label` = "o Notion", "o GitHub"...). */
export const API_MESSAGES = {
  timeout: (label: string): string =>
    `${capitalize(label)} demorou demais para responder. Verifique sua conexão e tente novamente.`,
  network: (label: string): string =>
    `Não foi possível falar com ${label}. Verifique sua conexão com a internet.`,
  server: (label: string, status: number): string =>
    `${capitalize(label)} está instável agora (erro ${status}). Tente novamente em instantes.`,
  unexpected: (label: string, status: number): string =>
    `Resposta inesperada d${label} (HTTP ${status}). Tente novamente.`,
  rateLimited: (label: string, waitMs: number | null): string =>
    `${capitalize(label)} limitou as requisições. Tente novamente ${
      waitMs === null ? 'em alguns segundos' : formatWait(waitMs)
    }.`
} as const

/** Para quem o erro fala: o serviço e, se diferente do padrão, o nome dele na mensagem. */
export interface ApiTarget {
  service: ApiService
  /** Padrão: `SERVICE_LABELS[service]`. */
  label?: string
}

const labelOf = (target: ApiTarget): string => target.label ?? SERVICE_LABELS[target.service]

export function unexpectedError(target: ApiTarget, status: number): ApiError {
  return new ApiError(
    target.service,
    'unexpected',
    API_MESSAGES.unexpected(labelOf(target), status),
    status
  )
}

/** 5xx → `server`; qualquer outro status sem regra própria → `unexpected`. */
export function genericStatusError(target: ApiTarget, status: number): ApiError {
  return status >= 500
    ? new ApiError(target.service, 'server', API_MESSAGES.server(labelOf(target), status), status)
    : unexpectedError(target, status)
}

export function rateLimitedError(target: ApiTarget, waitMs: number | null): ApiError {
  return new ApiError(
    target.service,
    'rate_limited',
    API_MESSAGES.rateLimited(labelOf(target), waitMs),
    429
  )
}

// ---------- Pedido com prazo ----------

/** Corpo lido com limite: respostas que usamos cabem com folga. */
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PATCH'
  headers?: Record<string, string>
  /** JSON já serializado. */
  body?: string
  /** `'error'`: nunca seguir redirecionamento (o corpo iria para outro endereço). */
  redirect?: 'error' | 'follow' | 'manual'
}

export interface HttpOptions extends ApiTarget {
  /** Resolvido na hora da chamada (respeita substituições de `globalThis.fetch`). */
  fetch?: typeof fetch | undefined
  timeoutMs: number
  maxBodyBytes?: number
  /** Mensagens próprias de quem chama (ex.: "a revisão pode ter sido publicada"). */
  messages?: { timeout?: string; network?: string }
}

export interface HttpResponse {
  status: number
  ok: boolean
  headers: Headers
  /** Corpo inteiro como texto; `null` se passou do limite. */
  text: string | null
}

/**
 * Faz o pedido e lê o corpo dentro do mesmo prazo. Tempo esgotado (no pedido ou na leitura) →
 * `timeout`; qualquer outra falha de transporte → `network`. Nunca repassa a exceção original.
 */
export async function fetchWithTimeout(
  request: HttpRequest,
  options: HttpOptions
): Promise<HttpResponse> {
  const doFetch = options.fetch ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await doFetch(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      ...(request.body !== undefined ? { body: request.body } : {}),
      ...(request.redirect ? { redirect: request.redirect } : {}),
      signal: controller.signal
    })
    const text = await readLimitedText(
      response,
      options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      controller.signal
    )
    return { status: response.status, ok: response.ok, headers: response.headers, text }
  } catch {
    // Não propagamos a exceção original: ela pode carregar detalhes da requisição.
    const label = labelOf(options)
    throw controller.signal.aborted
      ? new ApiError(
          options.service,
          'timeout',
          options.messages?.timeout ?? API_MESSAGES.timeout(label)
        )
      : new ApiError(
          options.service,
          'network',
          options.messages?.network ?? API_MESSAGES.network(label)
        )
  } finally {
    clearTimeout(timer)
  }
}

/** Corpo até `max` bytes (passou disso → `null`). Abortou durante a leitura → lança. */
async function readLimitedText(
  response: Response,
  max: number,
  signal: AbortSignal
): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const onAbort = (): void => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (signal.aborted) throw new Error('aborted')
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(Buffer.concat(chunks))
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** JSON do corpo, ou `null` se vazio, grande demais ou inválido. */
export function jsonOrNull(response: HttpResponse): unknown {
  if (!response.text) return null
  try {
    return JSON.parse(response.text) as unknown
  } catch {
    return null
  }
}

/** JSON do corpo; vazio, grande demais ou inválido → `unexpected`. */
export function readJson(response: HttpResponse, target: ApiTarget): unknown {
  const body = jsonOrNull(response)
  if (body === null) throw unexpectedError(target, response.status)
  return body
}

/** Pedido JSON (POST/GET) com prazo: status e o JSON da resposta (`null` se não houver). */
export async function requestJson(
  request: HttpRequest,
  options: HttpOptions
): Promise<{ status: number; ok: boolean; headers: Headers; body: unknown }> {
  const response = await fetchWithTimeout(request, options)
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body: jsonOrNull(response)
  }
}

// ---------- Uma nova tentativa curta ----------

/** Esperamos e repetimos uma vez se o serviço pedir até este tempo; acima disso, erro. */
export const SHORT_RETRY_MAX_WAIT_MS = 5_000

/**
 * Faz o pedido; se `waitOf` disser que é rate limit com espera ≤ 5 s na primeira vez, espera e
 * repete uma vez. Devolve a última resposta e a espera pedida (`null` se não for rate limit).
 */
export async function sendWithShortRetry<W extends { ms: number }>(
  send: () => Promise<HttpResponse>,
  waitOf: (response: HttpResponse) => W | null,
  sleep: (ms: number) => Promise<void>
): Promise<{ response: HttpResponse; wait: W | null }> {
  for (let attempt = 0; ; attempt++) {
    const response = await send()
    const wait = response.ok ? null : waitOf(response)
    if (wait && attempt === 0 && wait.ms <= SHORT_RETRY_MAX_WAIT_MS) {
      await sleep(wait.ms)
      continue
    }
    return { response, wait }
  }
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

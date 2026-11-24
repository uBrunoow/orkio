/**
 * Peças HTTP comuns às rotas do site (`/notion/*`, `/github/*`, `/health`): resposta JSON sem cache,
 * 405, leitura do corpo com limite, corpo JSON, limitador por IP e o override de endpoint que só
 * vale no E2E local. Nenhuma depende do Notion nem do GitHub.
 */
import { clientIp, type RateLimiter } from './rate-limit'

export function json(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  })
}

export function methodNotAllowed(allow: string): Response {
  return json(405, { error: 'method_not_allowed' }, { Allow: allow })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lê o corpo até `max` bytes; passou disso → `null` (sem confiar no Content-Length). */
export async function readLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Corpo JSON do pedido: content-type JSON (senão 415), até `max` bytes (senão 413) e JSON válido
 * (senão 400). Quem chama escolhe o código de erro do próprio contrato.
 */
export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; problem: 'json' | 'too_large' | 'content_type' }

export async function readJsonBody(request: Request, max: number): Promise<JsonBody> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return { ok: false, status: 415, problem: 'content_type' }
  }
  const text = await readLimited(request, max)
  if (text === null) return { ok: false, status: 413, problem: 'too_large' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, problem: 'json' }
  }
}

/** Limitador por IP antes do handler: estourou → 429 com `Retry-After`. */
export function withRateLimit(
  limiter: RateLimiter,
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const wait = limiter.check(clientIp(request))
  if (wait !== null) {
    return Promise.resolve(json(429, { error: 'rate_limited' }, { 'Retry-After': String(wait) }))
  }
  return handler()
}

/**
 * Endpoint alternativo só para o E2E local: ignorado na Vercel (`VERCEL`) e aceito apenas em
 * `http://127.0.0.1`. Qualquer outra coisa → `fallback`. Devolve a URL inteira normalizada.
 */
export function loopbackOverride(
  env: { VERCEL?: string | undefined },
  value: string | undefined,
  fallback: string
): string {
  const override = value?.trim()
  if (!override || env.VERCEL) return fallback
  try {
    const url = new URL(override)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? url.href : fallback
  } catch {
    return fallback
  }
}

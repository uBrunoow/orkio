import { describe, expect, it } from 'vitest'
import {
  API_MESSAGES,
  ApiError,
  fetchWithTimeout,
  genericStatusError,
  isTransientApiError,
  rateLimitedError,
  requestJson,
  sendWithShortRetry,
  type HttpResponse
} from './http'

/** Resposta cujo corpo chega em pedaços, com uma pausa antes do segundo. */
function slowBody(firstChunk: string, delayMs: number): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(firstChunk))
      await new Promise((r) => setTimeout(r, delayMs))
      controller.enqueue(encoder.encode('}'))
      controller.close()
    }
  })
  return new Response(stream, { status: 200 })
}

describe('fetchWithTimeout', () => {
  it('o prazo cobre a leitura do corpo (cabeçalho rápido, corpo lento → timeout)', async () => {
    const error = await fetchWithTimeout(
      { url: 'https://x.example/a' },
      { service: 'notion', fetch: async () => slowBody('{"a":1', 200), timeoutMs: 30 }
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ service: 'notion', code: 'timeout' })
    expect((error as Error).message).toBe(API_MESSAGES.timeout('o Notion'))
  })

  it('rede: nunca repassa a exceção original; mensagem pelo serviço ou a de quem chama', async () => {
    const fail = async (): Promise<Response> => {
      throw new Error('ECONNREFUSED token=SEGREDO')
    }
    const plain = await fetchWithTimeout(
      { url: 'https://x.example' },
      { service: 'github', fetch: fail, timeoutMs: 1000 }
    ).then(
      () => null as unknown as ApiError,
      (e: unknown) => e as ApiError
    )
    expect(plain.code).toBe('network')
    expect(plain.message).toBe(API_MESSAGES.network('o GitHub'))
    expect(plain.message).not.toContain('SEGREDO')
    const custom = await fetchWithTimeout(
      { url: 'https://x.example' },
      { service: 'site', fetch: fail, timeoutMs: 1000, messages: { network: 'sem site' } }
    ).then(
      () => null as unknown as ApiError,
      (e: unknown) => e as ApiError
    )
    expect(custom).toMatchObject({ service: 'site', code: 'network', message: 'sem site' })
  })

  it('corpo acima do limite vira null (JSON null), sem ler o resto', async () => {
    const big = async (): Promise<Response> => new Response('x'.repeat(100), { status: 200 })
    const r = await requestJson(
      { url: 'https://x.example' },
      { service: 'site', fetch: big, timeoutMs: 1000, maxBodyBytes: 10 }
    )
    expect(r).toMatchObject({ status: 200, body: null })
  })
})

describe('mensagens e classificação', () => {
  it('5xx → server; outro status → unexpected; rate limit em s ou min', () => {
    expect(genericStatusError({ service: 'notion' }, 503)).toMatchObject({
      code: 'server',
      message: 'O Notion está instável agora (erro 503). Tente novamente em instantes.'
    })
    expect(genericStatusError({ service: 'github' }, 418).message).toBe(
      'Resposta inesperada do GitHub (HTTP 418). Tente novamente.'
    )
    expect(rateLimitedError({ service: 'notion' }, 3000).message).toContain('em 3 s')
    expect(rateLimitedError({ service: 'notion' }, 180_000).message).toContain('em 3 min')
    expect(rateLimitedError({ service: 'notion' }, null).message).toContain('em alguns segundos')
  })

  it('transitório: rede, tempo, 5xx, 429 e resposta estranha; nunca recusa da conta', () => {
    for (const code of ['network', 'timeout', 'server', 'rate_limited', 'unexpected'] as const) {
      expect(isTransientApiError(new ApiError('github', code, 'x'))).toBe(true)
    }
    for (const code of [
      'unauthorized',
      'forbidden',
      'oauth_config',
      'invalid',
      'no_site'
    ] as const) {
      expect(isTransientApiError(new ApiError('github', code, 'x'))).toBe(false)
    }
    expect(isTransientApiError(new ApiError('notion', 'network', 'x'), 'github')).toBe(false)
    expect(isTransientApiError(new Error('network'))).toBe(false)
  })
})

describe('sendWithShortRetry', () => {
  const res = (status: number): HttpResponse => ({
    status,
    ok: status < 400,
    headers: new Headers(),
    text: ''
  })

  it('espera curta → uma nova tentativa; longa ou segunda vez → devolve a espera', async () => {
    const slept: number[] = []
    const sleep = async (ms: number): Promise<void> => void slept.push(ms)
    const statuses = [429, 200]
    const ok = await sendWithShortRetry(
      async () => res(statuses.shift()!),
      (r) => (r.status === 429 ? { ms: 2000 } : null),
      sleep
    )
    expect(ok.response.status).toBe(200)
    expect(ok.wait).toBeNull()
    expect(slept).toEqual([2000])

    const twice = await sendWithShortRetry(
      async () => res(429),
      () => ({ ms: 1000 }),
      sleep
    )
    expect(twice.wait).toEqual({ ms: 1000 })
    const long = await sendWithShortRetry(
      async () => res(429),
      () => ({ ms: 60_000 }),
      sleep
    )
    expect(long.wait).toEqual({ ms: 60_000 })
    expect(slept).toEqual([2000, 1000])
  })
})

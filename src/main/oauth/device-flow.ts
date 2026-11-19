/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628): laço de polling genérico.
 *
 * O provedor devolve um `user_code` para o usuário digitar no navegador; enquanto isso o app
 * consulta o endpoint de token no intervalo pedido, até receber o token, o código expirar,
 * o usuário recusar ou o fluxo ser cancelado. Não precisa de client secret nem de redirect.
 *
 * As chamadas HTTP ficam no conector (ex.: github.oauth.ts); aqui só o controle de tempo.
 */

export interface DeviceAuthorization {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresInSec: number
  intervalSec: number
}

export type DevicePollResult<T> =
  | { kind: 'token'; value: T }
  | { kind: 'pending' }
  /** `intervalSec`: novo intervalo informado pelo provedor, se houver. */
  | { kind: 'slow_down'; intervalSec?: number }
  | { kind: 'expired' }
  | { kind: 'denied' }

export type DeviceFlowErrorCode = 'cancelled' | 'expired' | 'denied'

export class DeviceFlowError extends Error {
  constructor(readonly code: DeviceFlowErrorCode) {
    super(code)
    this.name = 'DeviceFlowError'
  }
}

/** Segundos somados ao intervalo a cada `slow_down` (RFC 8628 §3.5). */
export const SLOW_DOWN_INCREMENT_SEC = 5
/** Falhas transitórias seguidas (rede, 5xx) toleradas durante o polling. */
export const MAX_CONSECUTIVE_POLL_FAILURES = 3

export interface PollDeviceTokenOptions<T> {
  authorization: DeviceAuthorization
  poll(deviceCode: string): Promise<DevicePollResult<T>>
  /** Erros que não encerram o fluxo (ex.: rede caiu por um instante). */
  isTransientError?(error: unknown): boolean
  signal: AbortSignal
  /** Momento em que o código foi emitido (ms). */
  startedAt: number
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export async function pollDeviceToken<T>(options: PollDeviceTokenOptions<T>): Promise<T> {
  const { authorization, signal } = options
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const deadline = options.startedAt + authorization.expiresInSec * 1000
  let intervalMs = Math.max(1, authorization.intervalSec) * 1000
  let failures = 0

  for (;;) {
    if (signal.aborted) throw new DeviceFlowError('cancelled')
    await sleep(intervalMs, signal)
    if (signal.aborted) throw new DeviceFlowError('cancelled')
    if (now() >= deadline) throw new DeviceFlowError('expired')

    let result: DevicePollResult<T>
    try {
      result = await options.poll(authorization.deviceCode)
      failures = 0
    } catch (error) {
      if (options.isTransientError?.(error) && ++failures < MAX_CONSECUTIVE_POLL_FAILURES) continue
      throw error
    }
    if (signal.aborted) throw new DeviceFlowError('cancelled')

    switch (result.kind) {
      case 'token':
        return result.value
      case 'pending':
        continue
      case 'slow_down':
        intervalMs = Math.max(
          intervalMs + SLOW_DOWN_INCREMENT_SEC * 1000,
          (result.intervalSec ?? 0) * 1000
        )
        continue
      case 'expired':
        throw new DeviceFlowError('expired')
      case 'denied':
        throw new DeviceFlowError('denied')
    }
  }
}

/** Espera `ms`, mas acorda imediatamente se o fluxo for cancelado. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

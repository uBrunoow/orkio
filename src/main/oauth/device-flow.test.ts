import { describe, expect, it, vi } from 'vitest'
import {
  DeviceFlowError,
  abortableSleep,
  pollDeviceToken,
  type DeviceAuthorization,
  type DevicePollResult
} from './device-flow'

const AUTH: DeviceAuthorization = {
  deviceCode: 'dev-code',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresInSec: 900,
  intervalSec: 5
}

/** Relógio falso: cada "sleep" avança o tempo, sem esperar de verdade. */
function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms)
      t += ms
    }),
    sleeps
  }
}

function run(
  results: (DevicePollResult<string> | Error)[],
  overrides: Partial<Parameters<typeof pollDeviceToken<string>>[0]> = {}
) {
  const clock = fakeClock()
  const queue = [...results]
  const poll = vi.fn(async (deviceCode: string) => {
    expect(deviceCode).toBe('dev-code')
    const next = queue.shift() ?? { kind: 'pending' as const }
    if (next instanceof Error) throw next
    return next
  })
  const controller = new AbortController()
  const promise = pollDeviceToken<string>({
    authorization: AUTH,
    poll,
    signal: controller.signal,
    startedAt: 0,
    now: clock.now,
    sleep: clock.sleep,
    ...overrides
  })
  return { promise, poll, clock, controller }
}

describe('pollDeviceToken', () => {
  it('espera o intervalo, segue em authorization_pending e devolve o token', async () => {
    const { promise, poll, clock } = run([
      { kind: 'pending' },
      { kind: 'pending' },
      { kind: 'token', value: 'tok' }
    ])
    await expect(promise).resolves.toBe('tok')
    expect(poll).toHaveBeenCalledTimes(3)
    expect(clock.sleeps).toEqual([5000, 5000, 5000])
  })

  it('slow_down soma 5 s ao intervalo (ou usa o intervalo informado, se maior)', async () => {
    const { promise, clock } = run([
      { kind: 'slow_down' },
      { kind: 'pending' },
      { kind: 'slow_down', intervalSec: 20 },
      { kind: 'token', value: 'tok' }
    ])
    await expect(promise).resolves.toBe('tok')
    expect(clock.sleeps).toEqual([5000, 10000, 10000, 20000])
  })

  it('expired_token → DeviceFlowError expired', async () => {
    const { promise } = run([{ kind: 'pending' }, { kind: 'expired' }])
    await expect(promise).rejects.toEqual(new DeviceFlowError('expired'))
  })

  it('expira pelo relógio mesmo se o provedor seguir respondendo pending', async () => {
    const { promise, poll } = run([], {
      authorization: { ...AUTH, expiresInSec: 12, intervalSec: 5 }
    })
    await expect(promise).rejects.toMatchObject({ code: 'expired' })
    expect(poll).toHaveBeenCalledTimes(2) // em t=5s e t=10s; em t=15s já expirou
  })

  it('access_denied → DeviceFlowError denied', async () => {
    const { promise } = run([{ kind: 'denied' }])
    await expect(promise).rejects.toMatchObject({ code: 'denied' })
  })

  it('cancelar durante a espera → cancelled, sem novo poll', async () => {
    const controller = new AbortController()
    const poll = vi.fn(async (): Promise<DevicePollResult<string>> => ({ kind: 'pending' }))
    const promise = pollDeviceToken<string>({
      authorization: { ...AUTH, intervalSec: 60 },
      poll,
      signal: controller.signal,
      startedAt: Date.now()
    })
    setTimeout(() => controller.abort(), 10)
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
    expect(poll).not.toHaveBeenCalled()
  })

  it('falhas transitórias são toleradas até o limite', async () => {
    const transient = new Error('rede')
    const ok = run([transient, transient, { kind: 'token', value: 'tok' }], {
      isTransientError: (e) => e === transient
    })
    await expect(ok.promise).resolves.toBe('tok')

    const tooMany = run([transient, transient, transient], {
      isTransientError: (e) => e === transient
    })
    await expect(tooMany.promise).rejects.toBe(transient)
  })

  it('erro não transitório encerra o fluxo na hora', async () => {
    const fatal = new Error('config')
    const { promise, poll } = run([fatal, { kind: 'token', value: 'x' }])
    await expect(promise).rejects.toBe(fatal)
    expect(poll).toHaveBeenCalledTimes(1)
  })
})

describe('abortableSleep', () => {
  it('acorda ao cancelar', async () => {
    const controller = new AbortController()
    const started = Date.now()
    const sleeping = abortableSleep(10_000, controller.signal)
    controller.abort()
    await sleeping
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

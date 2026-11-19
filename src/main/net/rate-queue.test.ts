import { afterEach, describe, expect, it, vi } from 'vitest'
import { RateQueue, backoffMs } from './rate-queue'

afterEach(() => {
  vi.useRealTimers()
})

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('RateQueue', () => {
  it('respeita a concorrência máxima', async () => {
    vi.useFakeTimers()
    const queue = new RateQueue({ concurrency: 2, minIntervalMs: 0 })
    const gates = [deferred(), deferred(), deferred()]
    let running = 0
    let peak = 0
    const tasks = gates.map((g) =>
      queue.run(async () => {
        running++
        peak = Math.max(peak, running)
        await g.promise
        running--
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(running).toBe(2)
    gates[0]!.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(running).toBe(2)
    gates[1]!.resolve()
    gates[2]!.resolve()
    await Promise.all(tasks)
    expect(peak).toBe(2)
  })

  it('espaça os inícios pelo intervalo mínimo (~3 req/s)', async () => {
    vi.useFakeTimers({ now: 0 })
    const queue = new RateQueue({ concurrency: 5, minIntervalMs: 350 })
    const starts: number[] = []
    const all = Promise.all(
      [1, 2, 3, 4].map(() => queue.run(async () => void starts.push(Date.now())))
    )
    await vi.advanceTimersByTimeAsync(2000)
    await all
    expect(starts).toEqual([0, 350, 700, 1050])
  })

  it('pause() segura todo mundo até o fim da pausa (Retry-After)', async () => {
    vi.useFakeTimers({ now: 0 })
    const queue = new RateQueue({ concurrency: 2, minIntervalMs: 0 })
    queue.pause(3000)
    const starts: number[] = []
    const all = Promise.all([1, 2].map(() => queue.run(async () => void starts.push(Date.now()))))
    await vi.advanceTimersByTimeAsync(2999)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await all
    expect(starts).toEqual([3000, 3000])
  })

  it('erro de uma tarefa não trava a fila', async () => {
    const queue = new RateQueue({ concurrency: 1, minIntervalMs: 0 })
    await expect(queue.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok')
    expect(queue.size).toBe(0)
  })
})

describe('backoffMs', () => {
  it('cresce exponencialmente com até 25% de jitter', () => {
    expect(backoffMs(0, () => 0)).toBe(1000)
    expect(backoffMs(2, () => 0)).toBe(4000)
    expect(backoffMs(2, () => 1)).toBe(5000)
  })
})

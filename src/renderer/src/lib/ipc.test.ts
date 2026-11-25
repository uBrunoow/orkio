import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSource, IPC_FAILURE, ipcResult, manySnapshot, ResultFailure, unwrap } from './ipc'

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.stubGlobal('document', { visibilityState: 'visible' })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createSource (uma carga, uma assinatura, um poll por fonte)', () => {
  it('vários leitores da mesma chave: uma carga e uma assinatura de eventos', async () => {
    const load = vi.fn(async (key: string) => `valor ${key}`)
    const off = vi.fn()
    const listen = vi.fn(() => off)
    const src = createSource({ load, listen })
    const a = src.subscribe('p1', () => undefined)
    const b = src.subscribe('p1', () => undefined)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(listen).toHaveBeenCalledTimes(1)
    expect(src.get('p1')).toEqual({ value: 'valor p1', error: null, loading: false })
    a()
    expect(off).not.toHaveBeenCalled()
    b()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('o poll relê cada chave lida uma vez por intervalo, só com a janela visível', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async (key: string) => key)
    const src = createSource({ load, pollMs: 1000 })
    src.subscribe('p1', () => undefined)
    src.subscribe('p1', () => undefined)
    src.subscribe('p2', () => undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(4)
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('reload sem argumento junta-se à carga em andamento; com argumento, pede de novo', async () => {
    const pending = deferred<string>()
    const load = vi.fn((_key: string, arg?: { force: boolean }) =>
      arg ? Promise.resolve('forçado') : pending.promise
    )
    const src = createSource({ load })
    src.subscribe('', () => undefined)
    void src.reload('')
    expect(load).toHaveBeenCalledTimes(1)
    await src.reload('', { force: true })
    expect(load).toHaveBeenCalledTimes(2)
    // A carga antiga chega depois: não sobrescreve a mais nova.
    pending.resolve('velho')
    await flush()
    expect(src.get('').value).toBe('forçado')
  })

  it('valor vindo de fora (evento, ação) vence uma carga em andamento', async () => {
    const pending = deferred<number>()
    const src = createSource({ load: () => pending.promise })
    src.subscribe('', () => undefined)
    src.set('', 7)
    pending.resolve(1)
    await flush()
    expect(src.get('').value).toBe(7)
  })

  it('ajuste de um evento antes da primeira carga não a cancela', async () => {
    const pending = deferred<number>()
    const src = createSource({ load: () => pending.promise })
    src.subscribe('', () => undefined)
    src.set('', (n) => (n === null ? null : n + 1))
    pending.resolve(1)
    await flush()
    expect(src.get('')).toEqual({ value: 1, error: null, loading: false })
  })

  it('falha: guarda o erro (do Result ou de IPC) e mantém o último valor', async () => {
    let call = 0
    const src = createSource({
      load: async () => {
        call++
        if (call === 1) return 'ok'
        if (call === 2) throw new ResultFailure({ code: 'broken', message: 'quebrou' })
        throw new Error('ipc caiu')
      }
    })
    src.subscribe('', () => undefined)
    await flush()
    await src.reload('')
    expect(src.get('')).toMatchObject({ value: 'ok', error: { code: 'broken' } })
    await src.reload('')
    expect(src.get('')).toMatchObject({ value: 'ok', error: IPC_FAILURE })
  })
})

describe('ipcResult / unwrap', () => {
  it('exceção do IPC vira Result de falha com a mensagem única', async () => {
    expect(await ipcResult(() => Promise.reject(new Error('x')))).toEqual({
      ok: false,
      error: IPC_FAILURE
    })
    expect(() => unwrap({ ok: false, error: { code: 'c', message: 'm' } })).toThrow(ResultFailure)
  })
})

describe('manySnapshot', () => {
  it('devolve o mesmo array enquanto cada chave tem o mesmo estado', async () => {
    const src = createSource<string>({ load: (k) => Promise.resolve(`v-${k}`) })
    const offA = src.subscribe('a', () => undefined)
    const offB = src.subscribe('b', () => undefined)
    await flush()
    const first = manySnapshot(src, ['a', 'b'], null)
    expect(first.map((s) => s.value)).toEqual(['v-a', 'v-b'])
    expect(manySnapshot(src, ['a', 'b'], first)).toBe(first)
    src.set('b', 'novo')
    const next = manySnapshot(src, ['a', 'b'], first)
    expect(next).not.toBe(first)
    expect(next.map((s) => s.value)).toEqual(['v-a', 'novo'])
    expect(next[0]).toBe(first[0])
    offA()
    offB()
  })

  it('troca o array quando as chaves mudam', () => {
    const src = createSource<string>({ load: () => new Promise(() => undefined) })
    const first = manySnapshot(src, ['a'], null)
    expect(manySnapshot(src, ['a', 'b'], first)).not.toBe(first)
    expect(manySnapshot(src, [], first)).toEqual([])
  })
})

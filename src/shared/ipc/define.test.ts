import { describe, expect, it, vi } from 'vitest'
import { IPC_EVENTS, ORKIO_API } from './api'
import { INVALID, buildApi, isCallSpec, isEventSpec, toPlain, type Transport } from './define'

function channels(spec: object): string[] {
  return Object.values(spec).flatMap((entry) =>
    isCallSpec(entry) || isEventSpec(entry) ? [entry.channel] : channels(entry as object)
  )
}

describe('declaração do IPC', () => {
  it('cada canal aparece uma vez', () => {
    const all = channels(ORKIO_API)
    const events = new Set(Object.values(IPC_EVENTS).map((e) => e.channel))
    const calls = all.filter((c) => !events.has(c))
    expect(new Set(calls).size).toBe(calls.length)
    expect(calls.some((c) => events.has(c))).toBe(false)
  })

  it('não tem mais o canal morto notionWorkspace.clear', () => {
    expect('clear' in ORKIO_API.notionWorkspace).toBe(false)
  })
})

describe('buildApi (preload)', () => {
  function transport(): Transport & { listeners: Map<string, (p: unknown) => void> } {
    const listeners = new Map<string, (p: unknown) => void>()
    return {
      listeners,
      invoke: vi.fn(async () => 'ok'),
      subscribe: vi.fn((channel, handler) => {
        listeners.set(channel, handler)
        return () => listeners.delete(channel)
      })
    }
  }

  it('invoca o canal declarado com os argumentos como estão (sem remontar objetos)', async () => {
    const t = transport()
    const api = buildApi(ORKIO_API, t)
    const request = {
      projectId: 'p1',
      taskId: 't1',
      text: 'oi',
      campoNovo: 'chega ao main',
      attachments: [{ name: 'a.md', mime: 'text/markdown', data: new Uint8Array([1, 2]) }]
    }
    await api.claude.send(request as never)
    expect(t.invoke).toHaveBeenCalledWith(ORKIO_API.claude.send.channel, [request])
    await api.openExternal('https://notion.so')
    expect(t.invoke).toHaveBeenLastCalledWith('shell:open-external', ['https://notion.so'])
  })

  it('eventos: o listener só recebe o payload validado; devolve unsubscribe', () => {
    const t = transport()
    const api = buildApi(ORKIO_API, t)
    const listener = vi.fn()
    const off = api.board.onOpenTask(listener)
    const emit = t.listeners.get(IPC_EVENTS.openTask.channel)!
    emit({ projectId: 'p1', taskId: 't1', section: 'flow', extra: 1 })
    emit({ projectId: 'p1', taskId: 't1', section: 'hack' })
    emit({ projectId: 1 })
    expect(listener.mock.calls).toEqual([
      [{ projectId: 'p1', taskId: 't1', section: 'flow' }],
      [{ projectId: 'p1', taskId: 't1' }]
    ])
    off()
    expect(t.listeners.has(IPC_EVENTS.openTask.channel)).toBe(false)
  })
})

describe('toPlain (argumentos do renderer)', () => {
  it('copia só dados: funções e protótipos não passam; bytes continuam bytes', () => {
    class Coisa {
      a = 1
      metodo(): number {
        return 2
      }
    }
    const bytes = new Uint8Array([1, 2, 3])
    const plain = toPlain({
      coisa: new Coisa(),
      fn: () => 1,
      list: [1, () => 2, undefined],
      bytes,
      n: Number.NaN
    }) as Record<string, unknown>
    expect(plain).toEqual({ coisa: { a: 1 }, list: [1, null, null], bytes, n: null })
    expect(Object.getPrototypeOf(plain['coisa'])).toBe(Object.prototype)
    expect(plain['bytes']).not.toBe(bytes)
  })
})

describe('eventos: validação do payload', () => {
  it('sync do quadro confere todos os campos, inclusive canReconnect', () => {
    const parse = IPC_EVENTS.boardSync.parse
    const base = { projectId: 'p1', taskId: 't1', state: 'failed', stageId: null, blocked: false }
    expect(parse({ ...base, canReconnect: true, message: 'x' })).toEqual({
      ...base,
      canReconnect: true,
      message: 'x'
    })
    expect(parse({ ...base, canReconnect: 'sim' })).toBe(INVALID)
    expect(parse({ ...base, state: 'hack' })).toBe(INVALID)
  })

  it('visão geral: total inteiro e não negativo', () => {
    const parse = IPC_EVENTS.overviewChanged.parse
    expect(parse({ waiting: 2 })).toEqual({ waiting: 2 })
    expect(parse({ waiting: -1 })).toBe(INVALID)
    expect(parse({ waiting: 1.5 })).toBe(INVALID)
  })
})

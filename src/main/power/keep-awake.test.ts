import { describe, expect, it } from 'vitest'
import { KeepAwake, type PowerBlocker } from './keep-awake'

function fakeBlocker(): PowerBlocker & { started: number; stopped: number } {
  const live = new Set<number>()
  let next = 1
  const b = {
    started: 0,
    stopped: 0,
    start() {
      b.started++
      const id = next++
      live.add(id)
      return id
    },
    stop(id: number) {
      b.stopped++
      live.delete(id)
    },
    isStarted: (id: number) => live.has(id)
  }
  return b
}

describe('KeepAwake', () => {
  it('liga só com a opção ligada e algo rodando, e desliga quando nada roda', () => {
    const blocker = fakeBlocker()
    let enabled = false
    let busy = false
    const k = new KeepAwake({ blocker, enabled: () => enabled, busy: () => busy })
    busy = true
    k.evaluate()
    expect(k.active).toBe(false) // opção desligada
    enabled = true
    k.evaluate()
    expect(k.active).toBe(true)
    k.evaluate()
    expect(blocker.started).toBe(1) // não liga duas vezes
    busy = false
    k.evaluate()
    expect(k.active).toBe(false)
    expect(blocker.stopped).toBe(1)
    busy = true
    k.evaluate()
    expect(blocker.started).toBe(2)
    enabled = false
    k.evaluate()
    expect(k.active).toBe(false)
  })
  it('dispose solta o bloqueio', () => {
    const blocker = fakeBlocker()
    const k = new KeepAwake({ blocker, enabled: () => true, busy: () => true })
    k.evaluate()
    k.dispose()
    expect(k.active).toBe(false)
    expect(blocker.stopped).toBe(1)
    k.evaluate()
    expect(k.active).toBe(false)
    expect(blocker.started).toBe(1)
  })
})

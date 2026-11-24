import { describe, expect, it } from 'vitest'
import { createStop, type StopParts } from './lifecycle'

function parts(log: string[], active: { queued: boolean }[]): StopParts {
  const step = (name: string) => () => void log.push(name)
  return {
    work: {
      flows: { dispose: step('flows.dispose') },
      runs: {
        cancelAll: step('runs.cancelAll'),
        activeRuns: () => active
      },
      writes: { stop: step('writes.stop') },
      scheduler: { stop: step('scheduler.stop') },
      overview: { dispose: step('overview.dispose') }
    },
    projects: { dispose: step('projects.dispose') },
    keepAwake: { dispose: step('keepAwake.dispose') },
    updates: { stop: step('updates.stop') }
  }
}

describe('createStop', () => {
  it('fechar o app: fluxo para de reagir ANTES de cancelar as execuções, tudo na hora', () => {
    const log: string[] = []
    const stop = createStop(() => parts(log, [{ queued: false }]))
    void stop({ waitMs: 0 })
    // Síncrono: o `before-quit` não espera promessa.
    expect(log).toEqual([
      'flows.dispose',
      'runs.cancelAll',
      'writes.stop',
      'scheduler.stop',
      'overview.dispose',
      'projects.dispose',
      'keepAwake.dispose',
      'updates.stop'
    ])
  })

  it('instalar atualização: espera as execuções saírem (até o prazo) e só então para o resto', async () => {
    const log: string[] = []
    const active = [{ queued: false }]
    let clock = 0
    const stop = createStop(() => parts(log, active), {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
        if (clock >= 600) active.length = 0
        log.push(`sleep ${clock}`)
      }
    })
    await stop({ waitMs: 12_000 })
    expect(log.slice(0, 2)).toEqual(['flows.dispose', 'runs.cancelAll'])
    expect(log.filter((l) => l.startsWith('sleep'))).toEqual([
      'sleep 200',
      'sleep 400',
      'sleep 600'
    ])
    expect(log.indexOf('writes.stop')).toBeGreaterThan(log.indexOf('sleep 600'))
  })

  it('um desligamento só: o before-quit depois da atualização não repete nada', async () => {
    const log: string[] = []
    const stop = createStop(() => parts(log, []))
    await stop({ waitMs: 12_000 })
    await stop({ waitMs: 0 })
    expect(log.filter((l) => l === 'runs.cancelAll')).toHaveLength(1)
  })

  it('sem banco local: para o que existe', async () => {
    const log: string[] = []
    const stop = createStop(() => ({ ...parts(log, []), work: null }))
    await stop({ waitMs: 12_000 })
    expect(log).toEqual(['projects.dispose', 'keepAwake.dispose', 'updates.stop'])
  })
})

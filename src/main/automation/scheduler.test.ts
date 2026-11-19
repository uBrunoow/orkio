import { describe, expect, it, vi } from 'vitest'
import type { CycleResult } from './automation.service'
import { AutomationScheduler } from './scheduler'

/** Relógio e timers manuais: `advance(ms)` dispara o que venceu, em ordem. */
function fakeTime() {
  let now = 0
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const t = { at: now + ms, fn, cancelled: false }
      timers.push(t)
      return { cancel: () => (t.cancelled = true) }
    },
    async advance(ms: number) {
      const target = now + ms
      for (;;) {
        const next = timers
          .filter((t) => !t.cancelled && t.at <= target)
          .sort((a, b) => a.at - b.at)[0]
        if (!next) break
        next.cancelled = true
        now = next.at
        next.fn()
        // Deixa as promessas do ciclo resolverem.
        for (let i = 0; i < 5; i++) await Promise.resolve()
      }
      now = target
    }
  }
}

const ok = (github: CycleResult['github'] = 'ok'): CycleResult => ({ github, events: 0, moves: 0 })

describe('AutomationScheduler', () => {
  function setup(results: CycleResult[] = []) {
    const time = fakeTime()
    const run = vi.fn<(projectId: string, options?: { force?: boolean }) => Promise<CycleResult>>(
      async () => results.shift() ?? ok()
    )
    let branches = ['main']
    const localBranches = vi.fn(async () => branches)
    const projects = vi.fn(() => ['p1'])
    const scheduler = new AutomationScheduler({
      run,
      projects,
      localBranches,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      intervalMs: 60_000,
      localIntervalMs: 5_000
    })
    return {
      time,
      run,
      projects,
      scheduler,
      setBranches: (b: string[]) => {
        branches = b
      }
    }
  }

  it('roda ao abrir e depois a cada ~60 s', async () => {
    const { time, run, scheduler } = setup()
    scheduler.start()
    await time.advance(0)
    expect(run).toHaveBeenCalledTimes(1)
    await time.advance(59_999)
    expect(run).toHaveBeenCalledTimes(1)
    await time.advance(1)
    expect(run).toHaveBeenCalledTimes(2)
    expect(scheduler.getStatus('p1')).toMatchObject({ github: 'ok', failures: 0 })
    scheduler.stop()
  })

  it('rate limit e erro → backoff exponencial (2, 4 min…) e volta ao normal no sucesso', async () => {
    const { time, run, scheduler } = setup([
      ok(),
      ok('rate_limited'),
      ok('rate_limited'),
      { github: 'unknown', events: 0, moves: 0, error: { code: 'network', message: 'x' } },
      ok()
    ])
    scheduler.start()
    await time.advance(0)
    await time.advance(60_000) // rate_limited
    expect(scheduler.getStatus('p1')).toMatchObject({ github: 'rate_limited', failures: 1 })
    await time.advance(119_999)
    expect(run).toHaveBeenCalledTimes(2)
    await time.advance(1) // rate_limited de novo
    expect(scheduler.getStatus('p1').failures).toBe(2)
    await time.advance(240_000) // erro
    expect(scheduler.getStatus('p1')).toMatchObject({ failures: 3, error: 'x' })
    await time.advance(480_000) // ok
    expect(scheduler.getStatus('p1')).toMatchObject({ failures: 0, github: 'ok' })
    expect(run).toHaveBeenCalledTimes(5)
    scheduler.stop()
  })

  it('backoff tem teto de 15 min', async () => {
    const { time, scheduler } = setup(Array.from({ length: 20 }, () => ok('unverified')))
    scheduler.start()
    for (let i = 0; i < 10; i++) await time.advance(15 * 60_000)
    const status = scheduler.getStatus('p1')
    expect(status.nextRunAt! - time.now()).toBeLessThanOrEqual(15 * 60_000)
    scheduler.stop()
  })

  it('branch local criada sem checkout → ciclo imediato (sem esperar o minuto)', async () => {
    const { time, run, scheduler, setBranches } = setup()
    scheduler.start()
    await time.advance(5_000) // linha de base local
    const calls = run.mock.calls.length
    setBranches(['main', 'ORK-1/x'])
    await time.advance(5_000)
    expect(run.mock.calls.length).toBe(calls + 1)
    expect(run).toHaveBeenLastCalledWith('p1', { force: false })
    scheduler.stop()
  })

  it('HeadWatcher e "Verificar agora"', async () => {
    const { time, run, scheduler } = setup()
    scheduler.start()
    await time.advance(0)
    scheduler.onLocalChange('p1')
    await Promise.resolve()
    expect(run).toHaveBeenLastCalledWith('p1', { force: false })
    await scheduler.runNow('p1')
    expect(run).toHaveBeenLastCalledWith('p1', { force: true })
    scheduler.onLocalChange('outro-projeto')
    expect(run).not.toHaveBeenCalledWith('outro-projeto', expect.anything())
    scheduler.stop()
  })

  it('projetos novos entram e removidos saem no sync; parado não roda nada', async () => {
    const { time, run, projects, scheduler } = setup()
    scheduler.start()
    await time.advance(0)
    projects.mockReturnValue(['p1', 'p2'])
    scheduler.sync()
    await time.advance(0)
    expect(run).toHaveBeenCalledWith('p2', { force: false })
    projects.mockReturnValue(['p2'])
    scheduler.sync()
    run.mockClear()
    await time.advance(120_000)
    expect(run.mock.calls.every(([id]) => id === 'p2')).toBe(true)
    scheduler.stop()
    run.mockClear()
    await time.advance(600_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('exceção no ciclo não derruba o agendador', async () => {
    const { time, run, scheduler } = setup()
    run.mockRejectedValueOnce(new Error('boom'))
    scheduler.start()
    await time.advance(0)
    expect(scheduler.getStatus('p1').failures).toBe(1)
    await time.advance(120_000)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
})

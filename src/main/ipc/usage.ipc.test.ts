import { describe, expect, it, vi } from 'vitest'
import { usageHandlers } from './usage.ipc'
import { emptyConfig, type OrkioConfig } from '../config/orkio-config'

function setup(initial: Partial<OrkioConfig> = {}, readOnly = false) {
  let config: OrkioConfig = { ...emptyConfig(), ...initial }
  const store = {
    readOnly,
    get: () => config,
    update: async (mutate: (c: OrkioConfig) => OrkioConfig) => (config = mutate(config))
  }
  const usage = {
    get: vi.fn(async () => ({ session: null, weekly: null, checkedAt: 'x' })),
    reset: vi.fn()
  }
  const h = usageHandlers(usage, store)
  const event = {} as Parameters<typeof h.claude>[0]
  return { h, usage, event, config: () => config }
}

describe('usageHandlers', () => {
  it('ligado por padrão; desligar grava false, não consulta e esquece o cache', async () => {
    const { h, usage, event, config } = setup()
    expect((await h.claude(event)).enabled).toBe(true)
    expect(await h.setEnabled(false, event)).toBe(false)
    expect(config().usageMeter).toBe(false)
    expect(usage.reset).toHaveBeenCalled()
    usage.get.mockClear()
    expect(await h.claude(event)).toMatchObject({ enabled: false, usage: null })
    expect(usage.get).not.toHaveBeenCalled()
    expect(await h.setEnabled(true, event)).toBe(true)
    expect(config()).not.toHaveProperty('usageMeter')
  })
  it('config só leitura: não muda', async () => {
    const { h, event } = setup({ usageMeter: false }, true)
    expect(await h.setEnabled(true, event)).toBe(false)
  })
})

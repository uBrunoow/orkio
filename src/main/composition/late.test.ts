import { describe, expect, it } from 'vitest'
import { late } from './late'

describe('late', () => {
  it('usar antes de criar lança (em vez de sumir com o pedido, como o `?.` de antes)', () => {
    const scheduler = late<{ runNow(): string }>('Agendador')
    expect(() => scheduler().runNow()).toThrow('Agendador usado antes de ser criado')
    scheduler.set({ runNow: () => 'ok' })
    expect(scheduler().runNow()).toBe('ok')
    expect(() => scheduler.set({ runNow: () => 'outro' })).toThrow('já foi criado')
  })
})

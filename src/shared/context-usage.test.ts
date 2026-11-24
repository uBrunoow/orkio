import { describe, expect, it } from 'vitest'
import { contextPercent, contextWindowFor, inputTokensOf } from './context-usage'

describe('contexto do Claude Code', () => {
  it('janela: 200 mil, ou 1 milhão com [1m] no modelo', () => {
    expect(contextWindowFor('claude-sonnet-4')).toBe(200_000)
    expect(contextWindowFor(null)).toBe(200_000)
    expect(contextWindowFor('claude-opus-4[1m]')).toBe(1_000_000)
  })
  it('tokens de entrada somam entrada, cache lido e cache criado', () => {
    expect(
      inputTokensOf({
        input_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 10,
        output_tokens: 999
      })
    ).toBe(100)
    expect(inputTokensOf({ output_tokens: 5 })).toBeNull()
    expect(inputTokensOf(null)).toBeNull()
  })
  it('contextPercent arredonda, limita a 100 e recusa janela inválida', () => {
    expect(contextPercent(82_000, 200_000)).toBe(41)
    expect(contextPercent(300_000, 200_000)).toBe(100)
    expect(contextPercent(0, 200_000)).toBe(0)
    expect(contextPercent(10, 0)).toBeNull()
    expect(contextPercent(-1, 200_000)).toBeNull()
    expect(contextPercent(Number.NaN, 200_000)).toBeNull()
  })
})

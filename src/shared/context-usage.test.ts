import { describe, expect, it } from 'vitest'
import {
  contextPercent,
  contextWindowFor,
  fitWindow,
  inputTokensOf,
  windowFromModelUsage
} from './context-usage'

describe('contexto do Claude Code', () => {
  it('janela: 200 mil, ou 1 milhão com [1m] no modelo', () => {
    expect(contextWindowFor('claude-sonnet-4')).toBe(200_000)
    expect(contextWindowFor(null)).toBe(200_000)
    expect(contextWindowFor('claude-opus-4[1m]')).toBe(1_000_000)
  })
  it('janela que cabe os tokens: acima de 200 mil só pode ser a de 1 milhão', () => {
    expect(fitWindow(150_000, 200_000)).toBe(200_000)
    expect(fitWindow(215_000, 200_000)).toBe(1_000_000)
    expect(fitWindow(215_000, 1_000_000)).toBe(1_000_000)
  })
  it('janela informada pelo CLI no resultado (modelUsage), a do modelo da execução', () => {
    const usage = {
      'claude-opus-5-5': { contextWindow: 1_000_000, inputTokens: 2 },
      'claude-haiku-4-5': { contextWindow: 200_000 }
    }
    expect(windowFromModelUsage(usage, 'claude-opus-5-5')).toBe(1_000_000)
    // Sem o modelo da execução: a maior (a conversa principal usa o modelo grande).
    expect(windowFromModelUsage(usage, null)).toBe(1_000_000)
    expect(windowFromModelUsage({ x: { contextWindow: 'muito' } }, null)).toBeNull()
    expect(windowFromModelUsage(undefined, 'x')).toBeNull()
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

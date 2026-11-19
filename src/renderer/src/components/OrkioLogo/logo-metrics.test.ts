import { describe, expect, it } from 'vitest'
import { resolveLogoVariant, wordmarkMetrics } from './logo-metrics'

describe('resolveLogoVariant', () => {
  it('usa simple automaticamente abaixo de 48px', () => {
    expect(resolveLogoVariant('full', 47)).toBe('simple')
    expect(resolveLogoVariant('full', 24)).toBe('simple')
    expect(resolveLogoVariant('simple', 24)).toBe('simple')
  })

  it('respeita a variante pedida a partir de 48px', () => {
    expect(resolveLogoVariant('full', 48)).toBe('full')
    expect(resolveLogoVariant('full', 96)).toBe('full')
    expect(resolveLogoVariant('simple', 96)).toBe('simple')
  })
})

describe('wordmarkMetrics', () => {
  it('Jost 400 quando o wordmark tem ≤ 18px', () => {
    expect(wordmarkMetrics(28)).toMatchObject({ fontSize: 18, fontWeight: 400 })
    expect(wordmarkMetrics(16).fontWeight).toBe(400)
  })

  it('Jost 300 acima de 18px', () => {
    expect(wordmarkMetrics(30)).toMatchObject({ fontSize: 19, fontWeight: 300 })
    expect(wordmarkMetrics(80).fontWeight).toBe(300)
  })
})

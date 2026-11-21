import { describe, expect, it } from 'vitest'
import { formatDuration, formatUsd, plural } from './format'

describe('format', () => {
  it('plural', () => {
    expect(plural(1, 'arquivo', 'arquivos')).toBe('1 arquivo')
    expect(plural(0, 'arquivo', 'arquivos')).toBe('0 arquivos')
    expect(plural(3, 'mudança não commitada', 'mudanças não commitadas')).toBe(
      '3 mudanças não commitadas'
    )
  })
  it('dólar com vírgula', () => {
    expect(formatUsd(0.0123)).toBe('US$ 0,01')
    expect(formatUsd(1234.5)).toBe('US$ 1.234,50')
  })
  it('duração curta', () => {
    expect(formatDuration(400)).toBe('1 s')
    expect(formatDuration(39_000)).toBe('39 s')
    expect(formatDuration(18 * 60_000)).toBe('18 min')
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min')
    expect(formatDuration(120 * 60_000)).toBe('2 h')
  })
})

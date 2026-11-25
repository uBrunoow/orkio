import { describe, expect, it } from 'vitest'
import {
  TERMINAL_LIMITS,
  isSessionUuid,
  isTerminalId,
  parseTerminalSize,
  trimScrollback,
  unseenPart
} from './terminal'

describe('terminal (shared)', () => {
  it('lote x foto: só o que a foto ainda não tinha', () => {
    expect(unseenPart({ id: 't', data: 'abc', at: 0 }, 3)).toBeNull()
    expect(unseenPart({ id: 't', data: 'abcdef', at: 0 }, 3)).toBe('def')
    expect(unseenPart({ id: 't', data: 'xyz', at: 5 }, 3)).toBe('xyz')
    expect(unseenPart({ id: 't', data: 'xyz', at: 3 }, 3)).toBe('xyz')
  })

  it('tamanho: inteiros dentro dos limites', () => {
    expect(parseTerminalSize({ cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 })
    expect(parseTerminalSize({ cols: 80.5, rows: 24 })).toBeNull()
    expect(parseTerminalSize({ cols: TERMINAL_LIMITS.maxCols + 1, rows: 24 })).toBeNull()
    expect(parseTerminalSize({ cols: 80 })).toBeNull()
    expect(parseTerminalSize('80x24')).toBeNull()
  })

  it('ids e sessões: só o formato exato', () => {
    expect(isTerminalId('t-0123456789abcdef')).toBe(true)
    expect(isTerminalId('../t-1')).toBe(false)
    expect(isSessionUuid('0f8c2a3e-1b2c-4d5e-8f90-123456789abc')).toBe(true)
    expect(isSessionUuid('--fork-session')).toBe(false)
    expect(isSessionUuid(null)).toBe(false)
  })

  it('guarda só o fim da saída', () => {
    expect(trimScrollback('abcdef', 3)).toBe('def')
    expect(trimScrollback('ab', 3)).toBe('ab')
  })
})

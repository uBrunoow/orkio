import { describe, expect, it } from 'vitest'
import { parseRetryAfterMs } from './parse'

describe('parseRetryAfterMs', () => {
  it('aceita segundos e datas HTTP', () => {
    expect(parseRetryAfterMs('3')).toBe(3000)
    expect(parseRetryAfterMs('0.5')).toBe(500)
    const now = Date.parse('2026-11-19T12:00:00Z')
    expect(parseRetryAfterMs('Thu, 19 Nov 2026 12:00:04 GMT', now)).toBe(4000)
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs('amanhã')).toBeNull()
  })
})

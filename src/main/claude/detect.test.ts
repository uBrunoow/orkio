import { describe, expect, it } from 'vitest'
import { CLAUDE_EFFORT_VERSION } from '../../shared/agent-runtime'
import { supportsEffortVersion } from './detect'

describe('supportsEffortVersion', () => {
  it('limite em CLAUDE_EFFORT_VERSION (2.1.300)', () => {
    expect(CLAUDE_EFFORT_VERSION).toBe('2.1.300')
    expect(supportsEffortVersion('2.1.299')).toBe(false)
    expect(supportsEffortVersion('2.1.300')).toBe(true)
    expect(supportsEffortVersion('2.1.331')).toBe(true)
    expect(supportsEffortVersion('2.0.999')).toBe(false)
    expect(supportsEffortVersion(null)).toBe(false)
  })
})

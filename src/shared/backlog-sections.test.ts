import { describe, expect, it } from 'vitest'
import { splitBacklogBody } from './alva'

describe('splitBacklogBody', () => {
  it('separa no título do plano (inglês ou português)', () => {
    const body = '## Description\n\nFaz X.\n\n## Implementation Plan\n\n1. Passo\n\n## Notes\n\nfim'
    expect(splitBacklogBody(body)).toEqual({
      spec: '## Description\n\nFaz X.',
      plan: '## Implementation Plan\n\n1. Passo\n\n## Notes\n\nfim'
    })
    expect(splitBacklogBody('Spec\n\n## Plano de implementação\n\nP').plan).toBe(
      '## Plano de implementação\n\nP'
    )
  })

  it('sem plano: tudo é spec', () => {
    expect(splitBacklogBody('## Description\n\nFaz X.')).toEqual({
      spec: '## Description\n\nFaz X.',
      plan: null
    })
  })
})

import { describe, expect, it } from 'vitest'
import { parseTaskEvent } from './task-events'
import { describeEvent, prUrl } from './task-history'

/** Como lido do banco (o `detail` passa pelo parser do catálogo). */
const review = (detail: Record<string, unknown>) =>
  parseTaskEvent({
    kind: 'delivery',
    source: 'system',
    fromStage: null,
    toStage: null,
    detail: {
      by: 'orkio',
      action: 'review_post',
      owner: 'acme',
      repo: 'app',
      pr: { number: 7, owner: 'acme', repo: 'app' },
      ...detail
    }
  })!

describe('revisão publicada como orkio[bot] no histórico (Task 18)', () => {
  it('texto com o tipo e link direto para a revisão na PR', () => {
    const e = review({ reviewEvent: 'REQUEST_CHANGES', reviewId: 42 })
    expect(describeEvent(e, () => '')).toBe(
      'Revisão publicada na PR #7 como orkio[bot] (pedir alterações)'
    )
    expect(prUrl(e)).toBe('https://github.com/acme/app/pull/7#pullrequestreview-42')
  })

  it('comentário; sem id válido, o link é o da PR', () => {
    const e = review({ reviewEvent: 'COMMENT', reviewId: 'x' })
    expect(describeEvent(e, () => '')).toContain('(comentário)')
    expect(prUrl(e)).toBe('https://github.com/acme/app/pull/7')
  })
})

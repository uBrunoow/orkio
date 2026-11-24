import { describe, expect, it } from 'vitest'
import { pendingCount, reviewHeadline } from './review'

const open = { id: 'a', resolved: false, outdated: false, path: null, line: null, comments: [] }

describe('reviewHeadline', () => {
  it('threads não lidas contam como pendentes (nunca "nenhum comentário")', () => {
    expect(reviewHeadline({ threads: [], unreadThreads: 3 }, 9)).toBe(
      '3 comentários pendentes na PR #9.'
    )
    expect(pendingCount({ threads: [open], unreadThreads: 2 })).toBe(3)
  })
  it('sem nada pendente e singular', () => {
    expect(reviewHeadline({ threads: [], unreadThreads: 0 }, 9)).toBe(
      'Nenhum comentário pendente na PR #9.'
    )
    expect(reviewHeadline({ threads: [open], unreadThreads: 0 }, 9)).toBe(
      '1 comentário pendente na PR #9.'
    )
  })
})

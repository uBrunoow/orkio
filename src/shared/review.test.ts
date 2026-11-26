import { describe, expect, it } from 'vitest'
import {
  actionableCount,
  changesRequestedBy,
  pendingCount,
  reviewHeadline,
  reviewsWithText
} from './review'

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

describe('revisões de topo (resumo, sem comentário em linha)', () => {
  const rv = (author: string, state: string, at: string, body = 'texto') => ({
    state,
    author,
    body,
    at
  })
  it('alterações pedidas aparecem no título, mesmo sem conversa em linha', () => {
    const reviews = [rv('oalexandre', 'CHANGES_REQUESTED', '2026-11-26T11:30:11Z')]
    expect(reviewHeadline({ threads: [], unreadThreads: 0, reviews }, 477)).toBe(
      'Alterações pedidas por @oalexandre na PR #477.'
    )
    expect(reviewHeadline({ threads: [open], unreadThreads: 0, reviews }, 477)).toBe(
      '1 comentário pendente e alterações pedidas por @oalexandre na PR #477.'
    )
  })
  it('vale a última revisão de cada pessoa (aprovou depois = não pede mais)', () => {
    expect(
      changesRequestedBy([
        rv('ana', 'CHANGES_REQUESTED', '2026-11-26T10:00:00Z'),
        rv('ana', 'APPROVED', '2026-11-26T11:00:00Z', ''),
        rv('bia', 'CHANGES_REQUESTED', '2026-11-26T10:30:00Z')
      ])
    ).toEqual(['bia'])
  })
  it('revisões com texto, mais recentes primeiro (sem as vazias)', () => {
    expect(
      reviewsWithText([
        rv('ana', 'COMMENTED', '2026-11-26T10:00:00Z'),
        rv('bia', 'APPROVED', '2026-11-26T11:00:00Z', '  '),
        rv('caio', 'CHANGES_REQUESTED', '2026-11-26T12:00:00Z')
      ]).map((r) => r.author)
    ).toEqual(['caio', 'ana'])
  })
})

describe('actionableCount (corretor da PR)', () => {
  it('revisão que pede alterações só no texto conta, sem conversa em linha', () => {
    const reviews = [
      {
        state: 'CHANGES_REQUESTED',
        author: 'oalexandre',
        body: 'Ajustar X',
        at: '2026-11-25T10:00:00Z'
      }
    ]
    expect(actionableCount({ threads: [], unreadThreads: 0, reviews })).toBe(1)
    expect(actionableCount({ threads: [open], unreadThreads: 1, reviews })).toBe(3)
    // Aprovou depois: nada a tratar.
    const approved = [
      ...reviews,
      { state: 'APPROVED', author: 'oalexandre', body: '', at: '2026-11-25T11:00:00Z' }
    ]
    expect(actionableCount({ threads: [], unreadThreads: 0, reviews: approved })).toBe(0)
  })
})

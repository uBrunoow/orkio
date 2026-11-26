import { describe, expect, it, vi } from 'vitest'
import { moveToReviewedIfReviewing } from './review-self'

const STAGES = [
  { id: 'rev', name: 'Revisando', role: 'review' },
  { id: 'done-rev', name: 'Revisado', role: 'reviewed' },
  { id: 'work', name: 'Em andamento', role: 'work' }
]

function setup(state: { stageId: string; blocked: boolean } | null) {
  const applyAutomationMove = vi.fn(() => true)
  const flushWrites = vi.fn()
  const deps = {
    store: { state: () => state, transaction: <T>(fn: (tx: never) => T) => fn({} as never) },
    board: { applyAutomationMove, flushWrites },
    stages: () => STAGES
  }
  return { deps, applyAutomationMove, flushWrites }
}

describe('revisão com alterações pelo autor da PR (gh)', () => {
  it('em Revisando: move para Revisado, como o "alterações pedidas"', () => {
    const s = setup({ stageId: 'rev', blocked: false })
    expect(moveToReviewedIfReviewing(s.deps as never, 'p1', 't1')).toBe(true)
    expect(s.applyAutomationMove).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      't1',
      'done-rev',
      expect.objectContaining({ detail: { flow: 'review_self' } })
    )
    expect(s.flushWrites).toHaveBeenCalled()
  })
  it('bloqueada, fora de Revisando ou fora do quadro: não mexe', () => {
    for (const state of [
      { stageId: 'rev', blocked: true },
      { stageId: 'work', blocked: false },
      null
    ]) {
      const s = setup(state)
      expect(moveToReviewedIfReviewing(s.deps as never, 'p1', 't1')).toBe(false)
      expect(s.applyAutomationMove).not.toHaveBeenCalled()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { replyChips } from './reply-chips'

describe('replyChips', () => {
  it('aprovação: aprovar e pedir ajuste', () => {
    expect(replyChips('gate')).toEqual([
      { label: 'Aprovar', action: 'approve' },
      { label: 'Pedir ajuste…', action: 'adjust' }
    ])
    expect(replyChips('action')).toEqual(replyChips('gate'))
  })

  it('pergunta e permissão têm cartão próprio', () => {
    expect(replyChips('question')).toEqual([])
    expect(replyChips('permission')).toEqual([])
  })
})

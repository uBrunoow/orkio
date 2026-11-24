import { describe, expect, it } from 'vitest'
import { cardDetail, cardStatus } from './card-status'
import type { TaskSignals } from '../../../../shared/task-signals'

type Pr = NonNullable<TaskSignals['pr']>
const synced = { sync: { state: 'synced' as const } }
const withPr = (pr: Partial<Pr>): Pick<TaskSignals, 'pr'> => ({
  pr: { state: 'open', checks: null, reviewDecision: null, ...pr } as Pr
})

describe('cardStatus', () => {
  it('sem nada a dizer → null', () => {
    expect(cardStatus(synced, null, undefined)).toBeNull()
  })

  it('esperando você vence tudo e só o fluxo rodando é laranja', () => {
    const s = cardStatus({ sync: { state: 'failed' } }, 'needs_you', withPr({ checks: 'failure' }))
    expect(s).toEqual({ kind: 'flow', label: 'Esperando você', tone: 'warning' })
    for (const other of [
      cardStatus({ sync: { state: 'failed' } }, null, undefined),
      cardStatus(synced, null, withPr({ checks: 'failure' })),
      cardStatus(synced, null, withPr({ state: 'merged' }))
    ])
      expect(other?.tone).not.toBe('warning')
    expect(cardStatus(synced, 'running', undefined)?.tone).toBe('running')
  })

  it('falhas antes do que está rodando', () => {
    expect(cardStatus({ sync: { state: 'failed' } }, 'running', undefined)?.label).toBe(
      'Não sincronizou'
    )
    expect(cardStatus(synced, 'running', withPr({ checks: 'failure' }))?.label).toBe('CI falhou')
    expect(cardStatus(synced, 'running', withPr({ reviewDecision: 'changes_requested' }))).toEqual({
      kind: 'pr',
      label: 'Alterações pedidas',
      tone: 'danger'
    })
  })

  it('CI e revisão de PR fechada não contam', () => {
    expect(cardStatus(synced, null, withPr({ state: 'merged', checks: 'failure' }))?.label).toBe(
      'Mergeada'
    )
    expect(cardStatus(synced, null, withPr({ state: 'closed', checks: 'failure' }))).toBeNull()
  })

  it('sincronizando e PR aberta são neutros', () => {
    expect(cardStatus(synced, 'running', withPr({}))).toMatchObject({
      label: 'Fluxo rodando',
      tone: 'running'
    })
    expect(cardStatus({ sync: { state: 'pending' } }, null, withPr({}))?.label).toBe(
      'Sincronizando'
    )
    expect(cardStatus(synced, null, withPr({}))?.label).toBe('Em revisão')
    expect(cardStatus(synced, null, withPr({ state: 'draft' }))?.label).toBe('PR rascunho')
  })
})

describe('cardDetail', () => {
  it('linha de detalhe do card', () => {
    expect(cardDetail({ waiting: 'Aprovar plano', running: 'Alva · /implement', pr: null })).toBe(
      'Aprovar plano'
    )
    expect(cardDetail({ waiting: null, running: 'Alva · /implement', pr: null })).toBe(
      'Alva · /implement'
    )
    expect(
      cardDetail({
        waiting: null,
        running: null,
        pr: { number: 31, unresolvedComments: 2, checks: 'success' } as Pr
      })
    ).toBe('#31 · 2 comentários')
    expect(
      cardDetail({
        waiting: null,
        running: null,
        pr: { number: 27, unresolvedComments: 0, checks: 'success' } as Pr
      })
    ).toBe('#27 · CI ok')
    expect(cardDetail({ waiting: null, running: null, pr: null })).toBeNull()
  })
})

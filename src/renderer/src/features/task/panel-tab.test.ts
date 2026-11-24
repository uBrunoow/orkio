import { describe, expect, it } from 'vitest'
import { availableTabs, defaultPanelTab } from './panel-tab'

describe('availableTabs', () => {
  it('Spec e Plano só com documento do Backlog.md', () => {
    expect(availableTabs(false)).toEqual(['changes', 'pr', 'details'])
    expect(availableTabs(true)).toEqual(['spec', 'plan', 'changes', 'pr', 'details'])
  })

  it('Revisão aparece depois de PR & CI quando a tarefa tem PR', () => {
    expect(availableTabs(false, true)).toEqual(['changes', 'pr', 'review', 'details'])
    expect(availableTabs(true, true)).toEqual([
      'spec',
      'plan',
      'changes',
      'pr',
      'review',
      'details'
    ])
  })
})

describe('defaultPanelTab', () => {
  const base = { hasBacklogDoc: true, hasDiff: false, hasPr: false }
  it.each([
    ['Spec', 'spec'],
    ['Plano', 'plan'],
    ['Implementar', 'changes'],
    ['PR', 'pr']
  ] as const)('fase %s → aba %s', (phase, tab) => {
    expect(defaultPanelTab({ ...base, currentPhase: phase })).toBe(tab)
  })

  it('fase Revisão abre a aba Revisão com PR e Mudanças sem PR', () => {
    expect(defaultPanelTab({ ...base, currentPhase: 'Revisão', hasPr: true })).toBe('review')
    expect(defaultPanelTab({ ...base, currentPhase: 'Revisão' })).toBe('changes')
  })

  it('Plano sem documento cai em Mudanças ou Detalhes', () => {
    expect(
      defaultPanelTab({ currentPhase: 'Plano', hasBacklogDoc: false, hasDiff: true, hasPr: false })
    ).toBe('changes')
    expect(
      defaultPanelTab({ currentPhase: 'Plano', hasBacklogDoc: false, hasDiff: false, hasPr: false })
    ).toBe('details')
  })

  it('sem fase conhecida', () => {
    expect(defaultPanelTab({ ...base, currentPhase: null, hasDiff: true })).toBe('changes')
    expect(defaultPanelTab({ ...base, currentPhase: 'deploy' })).toBe('details')
  })
})

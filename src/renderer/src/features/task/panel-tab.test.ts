import { describe, expect, it } from 'vitest'
import { availableTabs, canOpen, defaultPanelTab, isSubview } from './panel-tab'

describe('painel da tarefa', () => {
  it('ícones do topo: Spec e Plano só com documento do Backlog.md', () => {
    expect(availableTabs(false)).toEqual(['details', 'changes', 'sidechat', 'terminal'])
    expect(availableTabs(true)).toEqual([
      'details',
      'changes',
      'sidechat',
      'terminal',
      'spec',
      'plan'
    ])
  })

  it('PR & CI, Revisão e Contexto são subtelas de Detalhes; Revisão só com PR', () => {
    expect(isSubview('pr')).toBe(true)
    expect(isSubview('context')).toBe(true)
    expect(isSubview('changes')).toBe(false)
    expect(canOpen('review', { hasBacklogDoc: false, hasPr: false })).toBe(false)
    expect(canOpen('review', { hasBacklogDoc: false, hasPr: true })).toBe(true)
    expect(canOpen('spec', { hasBacklogDoc: false, hasPr: true })).toBe(false)
  })

  it('abre no documento na fase de spec/plano; senão em Detalhes', () => {
    expect(defaultPanelTab({ currentPhase: 'spec', hasBacklogDoc: true })).toBe('spec')
    expect(defaultPanelTab({ currentPhase: 'plan', hasBacklogDoc: true })).toBe('plan')
    expect(defaultPanelTab({ currentPhase: 'plan', hasBacklogDoc: false })).toBe('details')
    expect(defaultPanelTab({ currentPhase: 'implement', hasBacklogDoc: true })).toBe('details')
    expect(defaultPanelTab({ currentPhase: null, hasBacklogDoc: false })).toBe('details')
  })
})

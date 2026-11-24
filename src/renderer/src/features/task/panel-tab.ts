/** Abas do painel da fase (direita da tela da tarefa) e qual abre primeiro. */
export type PanelTab = 'spec' | 'plan' | 'changes' | 'pr' | 'review' | 'details'

export const PANEL_TAB_LABEL: Record<PanelTab, string> = {
  spec: 'Spec',
  plan: 'Plano',
  changes: 'Mudanças',
  pr: 'PR & CI',
  review: 'Revisão',
  details: 'Detalhes'
}

/**
 * Spec e Plano só existem com a task do Backlog.md vinculada (D14); Revisão só com PR (os
 * comentários da PR).
 */
export function availableTabs(hasBacklogDoc: boolean, hasPr = false): PanelTab[] {
  return [
    ...(hasBacklogDoc ? (['spec', 'plan'] as const) : []),
    'changes',
    'pr',
    ...(hasPr ? (['review'] as const) : []),
    'details'
  ]
}

export function defaultPanelTab(input: {
  currentPhase: string | null
  hasBacklogDoc: boolean
  hasDiff: boolean
  hasPr: boolean
}): PanelTab {
  const fallback: PanelTab = input.hasDiff ? 'changes' : 'details'
  switch (input.currentPhase) {
    case 'Spec':
      return input.hasBacklogDoc ? 'spec' : fallback
    case 'Plano':
      return input.hasBacklogDoc ? 'plan' : fallback
    case 'Implementar':
      return 'changes'
    case 'Revisão':
      return input.hasPr ? 'review' : 'changes'
    case 'PR':
      return 'pr'
    default:
      return fallback
  }
}

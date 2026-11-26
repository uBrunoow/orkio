import type { TaskPhaseId } from '../../../../shared/task-phase'

/**
 * Painel ao lado da conversa (como no Claude Desktop): poucos ícones no topo (Detalhes, Notion, Mudanças,
 * Sidechat e, com a task do Backlog.md, Spec e Plano) e subtelas abertas pelas linhas de Detalhes
 * (PR & CI, Revisão, Contexto), com "voltar".
 */
export type PanelTab =
  | 'details'
  | 'notion'
  | 'changes'
  | 'sidechat'
  | 'terminal'
  | 'spec'
  | 'plan'
  | 'pr'
  | 'review'
  | 'context'

export const PANEL_TAB_LABEL: Record<PanelTab, string> = {
  details: 'Detalhes',
  notion: 'Notion',
  changes: 'Mudanças',
  sidechat: 'Sidechat',
  terminal: 'Terminal',
  spec: 'Spec',
  plan: 'Plano',
  pr: 'PR & CI',
  review: 'Revisão',
  context: 'Contexto'
}

/** Subtela aberta por uma linha de Detalhes (não tem ícone no topo). */
export const SUBVIEWS = ['pr', 'review', 'context'] as const satisfies readonly PanelTab[]

export function isSubview(tab: PanelTab): boolean {
  return (SUBVIEWS as readonly PanelTab[]).includes(tab)
}

/** Ícones do topo: Spec e Plano só com a task do Backlog.md vinculada (D14). */
export function availableTabs(hasBacklogDoc: boolean): PanelTab[] {
  return [
    'details',
    'notion',
    'changes',
    'sidechat',
    'terminal',
    ...(hasBacklogDoc ? (['spec', 'plan'] as const) : [])
  ]
}

/** Revisão só existe com PR (os comentários dela). */
export function canOpen(tab: PanelTab, input: { hasBacklogDoc: boolean; hasPr: boolean }): boolean {
  if (tab === 'spec' || tab === 'plan') return input.hasBacklogDoc
  if (tab === 'review') return input.hasPr
  return true
}

/** Ao abrir: na fase de spec/plano, o documento; senão Detalhes (que já resume o resto). */
export function defaultPanelTab(input: {
  currentPhase: TaskPhaseId | null
  hasBacklogDoc: boolean
}): PanelTab {
  if (input.hasBacklogDoc && input.currentPhase === 'spec') return 'spec'
  if (input.hasBacklogDoc && input.currentPhase === 'plan') return 'plan'
  return 'details'
}

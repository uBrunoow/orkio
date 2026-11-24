/**
 * Fases da tarefa (barra do topo da tela da tarefa): o que cada passo de fluxo faz, em etapas
 * fixas. Comandos do alva-flow e ações do Orkio dizem a fase deles; a tela decide o rótulo e a aba.
 */
export const TASK_PHASES = ['spec', 'plan', 'implement', 'review', 'pr'] as const
export type TaskPhaseId = (typeof TASK_PHASES)[number]

export const TASK_PHASE_LABEL: Record<TaskPhaseId, string> = {
  spec: 'Spec',
  plan: 'Plano',
  implement: 'Implementar',
  review: 'Revisão',
  pr: 'PR'
}

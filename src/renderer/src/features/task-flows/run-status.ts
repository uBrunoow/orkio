/** Estado de uma execução de fluxo na tela (rótulo + cor do token), usado no fim da conversa e no popover. */
import type { FlowRunStatus } from '../../../../shared/task-flow'

export type RunStatusColor = 'gray' | 'green' | 'red' | 'yellow' | 'orange' | 'blue'

export const RUN_STATUS: Record<FlowRunStatus, { label: string; color: RunStatusColor }> = {
  running: { label: 'Rodando', color: 'orange' },
  waiting_gate: { label: 'Esperando aprovação', color: 'yellow' },
  paused: { label: 'Pausado', color: 'red' },
  awaiting_decision: { label: 'Esperando sua decisão', color: 'yellow' },
  finished: { label: 'Concluído', color: 'green' },
  cancelled: { label: 'Cancelado', color: 'gray' }
}

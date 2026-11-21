import type { RunStatus } from '../../../../shared/agent-run'

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Na fila',
  running: 'Rodando',
  succeeded: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
}

export const STATUS_COLOR: Record<RunStatus, 'yellow' | 'orange' | 'green' | 'red' | 'gray'> = {
  queued: 'yellow',
  running: 'orange',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'gray'
}

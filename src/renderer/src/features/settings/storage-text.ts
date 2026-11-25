import type { StorageUsage } from '../../../../shared/preferences'
import { plural } from '../../lib/format'

const UNITS = ['KB', 'MB', 'GB', 'TB'] as const

/** Bytes em pt-BR até TB: "512 B", "3,4 KB", "1,2 GB" (inválido = "—"). */
export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const one = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${one.format(value)} ${UNITS[unit]}`
}

/** Linhas do Armazenamento (Diagnóstico): rótulo, valor e uma explicação. */
export function storageRows(s: StorageUsage): { label: string; value: string; detail: string }[] {
  return [
    {
      label: 'Execuções guardadas',
      value: formatStorageBytes(s.runsBytes),
      detail: `${plural(s.runsCount, 'execução', 'execuções')}. Ficam as ${s.runsKeptPerTask} mais recentes de cada tarefa; as mais antigas saem sozinhas.`
    },
    {
      label: 'Ambientes de tarefa',
      value: plural(s.worktrees, 'ambiente', 'ambientes'),
      detail: 'Cópias de trabalho do git, uma por tarefa. “Limpar ambiente” na tarefa apaga a dela.'
    },
    {
      label: 'Memória dos agentes',
      value: formatStorageBytes(s.agentMemoryBytes),
      detail: 'O que os agentes anotam para lembrar entre uma tarefa e outra.'
    }
  ]
}

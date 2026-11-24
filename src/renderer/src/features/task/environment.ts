import type { RunLogEvent } from '../../../../shared/agent-run'
import { contextPercent } from '../../../../shared/context-usage'

/** Último trecho do caminho da pasta de trabalho (funciona com `/` e `\`). */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Último `usage` do log e a porcentagem; `null` = log antigo ou sem uso (esconde a linha). */
export function latestContextPercent(log: readonly RunLogEvent[]): number | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]
    if (e && e.kind === 'usage') return contextPercent(e.inputTokens, e.contextWindow)
  }
  return null
}

export function contextTone(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warn'
  return 'ok'
}

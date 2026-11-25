import type { RunLogEvent } from '../../../../shared/agent-run'
import { contextPercent, contextWindowFor } from '../../../../shared/context-usage'
import { gitRepoOf, type ProjectRepo } from '../../../../shared/projects'

/**
 * Link da branch no github.com (`gitRepoOf`: verificado pela API ou só git local), ou `null`
 * (sem repositório, Enterprise, não verificado).
 */
export function branchTreeUrl(project: { repo: ProjectRepo | null }, branch: string): string | null {
  const repo = gitRepoOf(project)
  if (!repo) return null
  return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
    repo.name
  )}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`
}

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

export interface ContextUsage {
  percent: number
  inputTokens: number
  contextWindow: number
}

/** Último `usage` do log com os números (medidor do campo da sessão); `null` = sem uso ainda. */
export function latestContextUsage(log: readonly RunLogEvent[]): ContextUsage | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]
    if (e && e.kind === 'usage') {
      const percent = contextPercent(e.inputTokens, e.contextWindow)
      return percent === null
        ? null
        : { percent, inputTokens: e.inputTokens, contextWindow: e.contextWindow }
    }
  }
  return null
}

/** O mesmo uso medido na janela de outro modelo (o escolhido para a próxima mensagem). */
export function usageForModel(usage: ContextUsage, model: string): ContextUsage {
  const contextWindow = contextWindowFor(model)
  const percent = contextPercent(usage.inputTokens, contextWindow) ?? usage.percent
  return { ...usage, contextWindow, percent }
}

/** Tokens curtos: 850, 12k, 1,2M. */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

export function contextTone(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warn'
  return 'ok'
}

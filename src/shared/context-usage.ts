/** Uso do contexto da conversa do Claude Code (painel "Ambiente"). Só números, funções puras. */

export const DEFAULT_CONTEXT_WINDOW = 200_000
export const LONG_CONTEXT_WINDOW = 1_000_000

/** Janela do modelo: 1 milhão quando o nome do modelo tem `[1m]`, senão 200 mil. */
export function contextWindowFor(model: string | null | undefined): number {
  return typeof model === 'string' && model.toLowerCase().includes('[1m]')
    ? LONG_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW
}

/**
 * A janela que cabe os tokens: o Claude Code compacta antes de encher, então uso acima da janela
 * chutada quer dizer que o modelo tem a janela longa (ex.: Opus 5.5 = 1 milhão sem `[1m]`).
 */
export function fitWindow(inputTokens: number, contextWindow: number): number {
  return inputTokens > contextWindow ? Math.max(contextWindow, LONG_CONTEXT_WINDOW) : contextWindow
}

/**
 * Janela real informada pelo CLI no `result` (`modelUsage[<modelo>].contextWindow`): a do modelo da
 * execução; sem ele, a maior (a conversa principal usa o modelo grande; subagentes, os menores).
 */
export function windowFromModelUsage(modelUsage: unknown, model: string | null): number | null {
  if (typeof modelUsage !== 'object' || modelUsage === null) return null
  const windowOf = (v: unknown): number | null => {
    if (typeof v !== 'object' || v === null) return null
    const w = (v as Record<string, unknown>)['contextWindow']
    return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : null
  }
  const entries = modelUsage as Record<string, unknown>
  if (model) {
    const own = windowOf(entries[model])
    if (own !== null) return own
  }
  const all = Object.values(entries).flatMap((v) => {
    const w = windowOf(v)
    return w === null ? [] : [w]
  })
  return all.length ? Math.max(...all) : null
}

/** Tokens de entrada do turno (entrada + cache lido + cache criado), do `usage` da mensagem. */
export function inputTokensOf(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const u = usage as Record<string, unknown>
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const total =
    n(u['input_tokens']) + n(u['cache_read_input_tokens']) + n(u['cache_creation_input_tokens'])
  return total > 0 ? total : null
}

/** Percentual inteiro (0–100) do contexto usado; `null` se não der para calcular. */
export function contextPercent(inputTokens: number, contextWindow: number): number | null {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null
  }
  if (inputTokens < 0) return null
  return Math.min(100, Math.round((inputTokens / contextWindow) * 100))
}

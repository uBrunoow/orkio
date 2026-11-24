/** Uso do contexto da conversa do Claude Code (painel "Ambiente"). Só números, funções puras. */

export const DEFAULT_CONTEXT_WINDOW = 200_000
export const LONG_CONTEXT_WINDOW = 1_000_000

/** Janela do modelo: 1 milhão quando o nome do modelo tem `[1m]`, senão 200 mil. */
export function contextWindowFor(model: string | null | undefined): number {
  return typeof model === 'string' && model.toLowerCase().includes('[1m]')
    ? LONG_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW
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

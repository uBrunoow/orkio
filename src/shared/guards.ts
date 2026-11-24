/** Guardas genéricas para dados `unknown` (IPC, config, JSON). Puro, sem Node/DOM. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

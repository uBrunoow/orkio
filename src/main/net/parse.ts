/** Helpers puros de parsing usados pelos clients HTTP dos conectores. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** Retry-After pode ser segundos ("3") ou uma data HTTP. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

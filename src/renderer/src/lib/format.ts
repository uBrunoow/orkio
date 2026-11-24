/** Formatação de texto de UI em pt-BR (6E): plurais de verdade e moeda com vírgula. */

/** `plural(1, 'arquivo', 'arquivos')` → "1 arquivo"; `plural(2, …)` → "2 arquivos". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

const USD = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** Custo em dólar no formato brasileiro: "US$ 0,01". */
export function formatUsd(value: number): string {
  return USD.format(value).replace(/\u00a0/g, ' ')
}

/** Duração curta: "8 s", "3 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')} min` : ''}`
}

/** Tamanho de arquivo em pt-BR: "512 B", "3,4 KB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  const one = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${one.format(bytes / 1024)} KB`
  return `${one.format(bytes / (1024 * 1024))} MB`
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const DATE_TIME_LONG = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

function formatWith(format: Intl.DateTimeFormat, at: string | number | Date): string {
  const date = at instanceof Date ? at : new Date(at)
  return Number.isNaN(date.getTime()) ? '—' : format.format(date)
}

/** "24/11/2026, 14:05" (data inválida = "—"). */
export function formatDateTime(at: string | number | Date): string {
  return formatWith(DATE_TIME, at)
}

/** "24 de nov. de 2026, 14:05". */
export function formatDateTimeLong(at: string | number | Date): string {
  return formatWith(DATE_TIME_LONG, at)
}

/** "14:05". */
export function formatTime(at: string | number | Date): string {
  return formatWith(TIME, at)
}

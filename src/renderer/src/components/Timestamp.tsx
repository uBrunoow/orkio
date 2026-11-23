import { useEffect, useState } from 'react'

const RELATIVE = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
const ABSOLUTE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const DAY = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })

/** "há 3 min", "ontem", "12 de nov." (passado de 7 dias); a data completa no title. */
export function formatRelative(at: Date, now = Date.now()): string {
  const diff = (at.getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'agora'
  if (abs < 3600) return RELATIVE.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return RELATIVE.format(Math.round(diff / 3600), 'hour')
  if (abs < 7 * 86400) return RELATIVE.format(Math.round(diff / 86400), 'day')
  return DAY.format(at)
}

/** Data relativa que se atualiza a cada minuto, com a absoluta no tooltip nativo. */
export function Timestamp({
  value,
  className
}: {
  value: string | number | Date
  /** Mantido por compatibilidade (sempre relativo). */
  format?: 'auto'
  className?: string
}): React.JSX.Element {
  const date = value instanceof Date ? value : new Date(value)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])
  if (Number.isNaN(date.getTime())) return <span className={className}>—</span>
  return (
    <time dateTime={date.toISOString()} title={ABSOLUTE.format(date)} className={className}>
      {formatRelative(date)}
    </time>
  )
}

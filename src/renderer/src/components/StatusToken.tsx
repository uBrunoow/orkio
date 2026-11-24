import { cn } from '@/lib/utils'

/**
 * Estado único do app: ponto colorido + texto, nunca bloco.
 * - success: concluído, OK, aprovado
 * - warning: esperando você, falta configurar, não verificado
 * - danger: falhou, CI vermelho, alterações pedidas
 * - running: agente rodando (o único uso de laranja em estado, com halo)
 * - neutral: etapas, prioridade, o resto
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'running' | 'neutral'

const DOT_CLASS: Record<StatusTone, string> = {
  success: 'bg-ok',
  warning: 'bg-warn',
  danger: 'bg-danger',
  running: 'bg-brand ring-3 ring-brand-tint',
  neutral: 'bg-subtle-foreground'
}

export function StatusDot({
  tone,
  className
}: {
  tone: StatusTone
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-[7px] shrink-0 rounded-full', DOT_CLASS[tone], className)}
    />
  )
}

export function StatusToken({
  label,
  tone = 'neutral',
  className,
  ...rest
}: {
  label: string
  tone?: StatusTone
  className?: string
} & { [K in `data-${string}`]?: string }): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)} {...rest}>
      <StatusDot tone={tone} />
      <span className={tone === 'neutral' ? 'text-muted-foreground' : 'text-foreground'}>
        {label}
      </span>
    </span>
  )
}

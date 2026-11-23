import { cn } from '@/lib/utils'
import { InfoIcon, ProblemIcon } from './icons'

/**
 * Mensagem de erro/aviso/informação. Erros são `role="alert"` (urgente); os outros,
 * `role="status"`. `action`: link/botão ao lado da mensagem.
 */
export function Alert({
  tone,
  children,
  action,
  className
}: {
  tone: 'danger' | 'warning' | 'info'
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const Icon = tone === 'info' ? InfoIcon : ProblemIcon
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'danger' && 'border-danger-tint-border bg-danger-tint text-foreground',
        tone === 'warning' && 'border-warn-tint-border bg-warn-tint text-foreground',
        tone === 'info' && 'border-border bg-card text-foreground',
        className
      )}
    >
      <Icon
        className={cn(
          'mt-0.5',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warn',
          tone === 'info' && 'text-info'
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  )
}

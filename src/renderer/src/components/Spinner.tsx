import { cn } from '@/lib/utils'
import { SpinnerIcon } from './icons'

/** Indicador de carregando. Com `label`, vira `status` com nome acessível. */
export function Spinner({
  label,
  className
}: {
  label?: string
  className?: string
}): React.JSX.Element {
  return (
    <SpinnerIcon
      {...(label ? { role: 'status', 'aria-label': label, 'aria-hidden': undefined } : {})}
      className={cn('animate-spin', className)}
    />
  )
}

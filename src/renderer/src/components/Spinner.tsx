import { IconLoader2 } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

/** Indicador de carregando. Com `label`, vira `status` com nome acessível. */
export function Spinner({
  label,
  className
}: {
  label?: string
  className?: string
}): React.JSX.Element {
  return (
    <IconLoader2
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('size-4 shrink-0 animate-spin', className)}
      stroke={1.75}
    />
  )
}

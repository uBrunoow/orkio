import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ChevronRightIcon } from './icons'

export function CollapsibleHeader({
  open,
  children,
  className
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
        className
      )}
    >
      <ChevronRightIcon
        className={cn(
          'size-3.5 shrink-0 text-subtle-foreground transition-transform',
          open && 'rotate-90'
        )}
      />
      {children}
    </CollapsibleTrigger>
  )
}

import { cn } from '@/lib/utils'

/**
 * O h1 da tela. `look` 3 = título de seção (Configurações, 18 px como no mockup); 5 = título na
 * barra da tela (13 px, peso médio).
 */
export function ScreenTitle({
  look,
  maxLines,
  className,
  children
}: {
  look: 3 | 5
  maxLines?: number
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <h1
      className={cn(
        'min-w-0 font-medium text-foreground',
        look === 3 ? 'text-lg leading-tight' : 'text-sm',
        maxLines === 1 && 'truncate',
        className
      )}
    >
      {children}
    </h1>
  )
}

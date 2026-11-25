import { useId } from 'react'
import { cn } from '@/lib/utils'
import { SURFACE } from '../../components/surface'

/** Bloco de uma seção de Configurações: título (h2), uma linha de explicação e o conteúdo. */
export function SettingsCard({
  title,
  description,
  action,
  className,
  children
}: {
  title: string
  description?: React.ReactNode
  /** À direita do título (ex.: estado). */
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn(SURFACE.section, className)}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 id={id} className="text-sm font-medium text-foreground">
            {title}
          </h2>
          {action}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SvgIcon } from '../../components/icons'
import { StatusDot, type StatusTone } from '../../components/StatusToken'

/**
 * Um card de Integrações (grade): logo, nome, categoria, estado e a ação. A ação abre a
 * configuração (`children`) como uma linha inteira da grade logo abaixo do card.
 */
export function IntegrationCard({
  id,
  logo,
  logoClassName,
  name,
  category,
  status,
  action,
  open,
  onAction,
  children
}: {
  id: string
  logo: SvgIcon
  logoClassName?: string
  name: string
  /** Rótulo pequeno em mono (também usado na busca). */
  category: string
  status: { label: string; tone: StatusTone }
  action: string
  open: boolean
  onAction(): void
  children?: React.ReactNode
}): React.JSX.Element {
  const Logo = logo
  const titleId = `integration-${id}-name`
  return (
    <>
      <article
        aria-labelledby={titleId}
        data-testid={`catalog-${id}`}
        className="flex items-center gap-3 rounded-xl border border-border-soft bg-card p-3"
      >
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg',
            logoClassName ?? 'bg-muted text-foreground'
          )}
        >
          <Logo className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id={titleId} className="text-sm font-medium text-foreground">
            {name}
          </h3>
          <span className="font-mono text-2xs text-subtle-foreground">{category}</span>
          <span
            className="flex min-w-0 items-center gap-1.5 text-xs"
            data-testid="integration-status"
          >
            <StatusDot tone={status.tone} />
            <span
              className={cn(
                'truncate',
                status.tone === 'neutral' ? 'text-muted-foreground' : 'text-foreground'
              )}
            >
              {status.label}
            </span>
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${open ? 'Fechar' : action} ${name}`}
          aria-expanded={children ? open : undefined}
          onClick={onAction}
        >
          {open ? 'Fechar' : action}
        </Button>
      </article>
      {open && children && (
        <div className="col-span-full" data-integration={id}>
          {children}
        </div>
      )}
    </>
  )
}

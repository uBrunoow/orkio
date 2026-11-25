import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SvgIcon } from '../../components/icons'
import { StatusBadge, type StatusTone } from '../../components/StatusToken'

/**
 * Uma integração (linha na largura do container): logo, nome, estado em badge e a ação. A ação
 * abre a configuração (`children`) logo abaixo. A categoria não aparece; serve só à busca.
 */
export function IntegrationCard({
  id,
  logo,
  logoClassName,
  name,
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
        className="flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3"
      >
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            logoClassName ?? 'bg-muted text-foreground'
          )}
        >
          <Logo className="size-5" />
        </span>
        <h3 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {name}
        </h3>
        <StatusBadge
          label={status.label}
          tone={status.tone}
          data-testid="integration-status"
          className="max-w-[45%]"
        />
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

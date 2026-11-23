import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SvgIcon } from '../../components/icons'
import { StatusToken, type StatusTone } from '../../components/StatusToken'

/** Larguras das colunas (iguais no cabeçalho e nas linhas). */
export const INTEGRATION_COLS = {
  state: 'w-[220px] shrink-0',
  action: 'flex w-[170px] shrink-0 justify-end'
} as const

/** Cabeçalho das colunas da lista (só visual: cada linha já diz o serviço e o estado). */
export function IntegrationListHeader(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3.5 border-b border-border-soft px-4 py-2 text-2xs tracking-[0.06em] text-subtle-foreground uppercase"
    >
      <span className="w-8 shrink-0" />
      <span className="min-w-0 flex-1">Serviço</span>
      <span className={INTEGRATION_COLS.state}>Estado</span>
      <span className={INTEGRATION_COLS.action} />
    </div>
  )
}

/**
 * Uma linha de Integrações: logo, nome, o que o Orkio faz com o serviço, estado e a ação. A ação
 * abre o fluxo de conexão/configuração dentro da própria linha (`children`); `sub` = linhas
 * recuadas (ex.: Bancos e campos, abaixo do Notion).
 */
export function IntegrationRow({
  id,
  logo,
  logoClassName,
  name,
  purpose,
  status,
  action,
  isOpen,
  onToggle,
  children,
  sub
}: {
  id: string
  /** `null` = linha recuada (sub-item, sem logo). */
  logo: SvgIcon | null
  /** Cores do quadrado do logo (tokens). */
  logoClassName?: string
  name: string
  purpose: string
  status: { label: string; tone: StatusTone }
  action: string
  isOpen: boolean
  onToggle(): void
  children?: React.ReactNode
  sub?: React.ReactNode
}): React.JSX.Element {
  const Logo = logo
  const nested = Logo === null
  return (
    <li aria-label={name} data-testid={`catalog-${id}`} className="flex flex-col">
      <div
        className={cn(
          'flex items-center gap-3.5 py-3 pr-4',
          nested ? 'bg-surface pl-[62px]' : 'pl-4'
        )}
      >
        {Logo && (
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg',
              logoClassName ?? 'bg-muted text-foreground'
            )}
          >
            <Logo className="size-[18px]" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('font-medium text-foreground', nested ? 'text-[12.5px]' : 'text-sm')}>
            {name}
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{purpose}</span>
        </div>
        <div className={INTEGRATION_COLS.state}>
          <StatusToken label={status.label} tone={status.tone} data-testid="integration-status" />
        </div>
        <div className={INTEGRATION_COLS.action}>
          <Button
            size="sm"
            variant={isOpen ? 'ghost' : 'outline'}
            aria-label={`${isOpen ? 'Fechar' : action} ${name}`}
            aria-expanded={isOpen}
            onClick={onToggle}
          >
            {isOpen ? 'Fechar' : action}
          </Button>
        </div>
      </div>
      {isOpen && children && (
        <div
          className="flex flex-col gap-4 border-t border-border-soft bg-surface py-4 pr-4 pl-[62px]"
          data-integration={id}
        >
          {children}
        </div>
      )}
      {sub && <ul className="flex flex-col border-t border-border-soft">{sub}</ul>}
    </li>
  )
}

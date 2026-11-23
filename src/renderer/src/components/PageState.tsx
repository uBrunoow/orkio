import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from './Alert'

/** Vazio: título (h2), texto e ação opcional, numa caixa tracejada discreta. */
export function EmptyState({
  title,
  description,
  action,
  className
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={
        'flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-5 py-6 ' +
        (className ?? '')
      }
    >
      <h2 className="text-sm font-medium">{title}</h2>
      {description && <p className="max-w-prose text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * Estados de página/seção iguais em todo o app: carregando, vazio e erro.
 */
export function PageState(
  props:
    | { kind: 'loading'; label: string; rows?: number }
    | {
        kind: 'empty'
        title: string
        description: string
        action?: { label: string; onClick(): void }
      }
    | { kind: 'error'; message: string; action?: { label: string; onClick(): void } }
): React.JSX.Element {
  if (props.kind === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-label={props.label} aria-busy="true">
        {Array.from({ length: props.rows ?? 2 }, (_, i) => (
          <Skeleton key={i} className={i === 0 ? 'h-12' : 'h-40'} />
        ))}
      </div>
    )
  }
  if (props.kind === 'empty') {
    return (
      <EmptyState
        title={props.title}
        description={props.description}
        {...(props.action
          ? {
              action: (
                <Button variant="outline" size="sm" onClick={props.action.onClick}>
                  {props.action.label}
                </Button>
              )
            }
          : {})}
      />
    )
  }
  return (
    <Alert
      tone="danger"
      {...(props.action
        ? {
            action: (
              <Button size="sm" variant="ghost" onClick={props.action.onClick}>
                {props.action.label}
              </Button>
            )
          }
        : {})}
    >
      {props.message}
    </Alert>
  )
}

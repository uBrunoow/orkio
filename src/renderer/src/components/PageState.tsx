import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { VStack } from '@astryxdesign/core/VStack'
import { Alert } from './Alert'

/**
 * Estados de página/seção iguais em todo o app (6E): carregando, vazio e erro.
 * Erro usa o `Alert` (role="alert"); vazio usa o `EmptyState` com ação opcional.
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
      <VStack gap={3} aria-label={props.label} aria-busy="true">
        {Array.from({ length: props.rows ?? 2 }, (_, i) => (
          <Skeleton key={i} height={i === 0 ? 48 : 160} index={i} />
        ))}
      </VStack>
    )
  }
  if (props.kind === 'empty') {
    return (
      <EmptyState
        title={props.title}
        description={props.description}
        headingLevel={2}
        {...(props.action
          ? { actions: <Button label={props.action.label} onClick={props.action.onClick} /> }
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
              <Button
                size="sm"
                variant="ghost"
                label={props.action.label}
                onClick={props.action.onClick}
              />
            )
          }
        : {})}
    >
      {props.message}
    </Alert>
  )
}

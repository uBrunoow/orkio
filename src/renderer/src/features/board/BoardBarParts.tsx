import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/form'
import { Alert } from '../../components/Alert'
import type { BoardLayout } from '../../app/routes'
import type { BoardState } from '../../app/sources'

/** Peças repetidas do Quadro de um projeto e do Quadro de vários projetos. */

export function BoardViewControl({
  value,
  onChange
}: {
  value: BoardLayout
  onChange(view: BoardLayout): void
}): React.JSX.Element {
  return (
    <SegmentedControl
      label="Visualização do quadro"
      size="sm"
      value={value}
      onChange={(v) => onChange(v === 'list' ? 'list' : 'kanban')}
      options={[
        { value: 'kanban', label: 'Kanban' },
        { value: 'list', label: 'Lista' }
      ]}
    />
  )
}

/** Filtro de prioridade (some sem prioridades nos cards). */
export function PriorityFilter({
  priorities,
  value,
  onChange
}: {
  priorities: readonly string[]
  value: string | null
  onChange(priority: string | null): void
}): React.JSX.Element | null {
  if (priorities.length === 0) return null
  return (
    <Select
      aria-label="Prioridade"
      size="sm"
      placeholder="Todas as prioridades"
      clearLabel="Todas as prioridades"
      onClear={() => onChange(null)}
      options={priorities.map((p) => ({ value: p, label: p }))}
      value={value}
      onChange={(v) => onChange(v)}
      className="w-48"
    />
  )
}

export function PendingWritesAlert({
  count,
  onRetry
}: {
  count: number
  onRetry(): void
}): React.JSX.Element | null {
  if (count <= 0) return null
  return (
    <Alert
      tone="warning"
      action={
        <Button size="sm" variant="outline" onClick={onRetry}>
          Tentar agora
        </Button>
      }
    >
      {count === 1
        ? '1 alteração aguardando o Notion.'
        : `${count} alterações aguardando o Notion.`}{' '}
      Elas são enviadas sozinhas quando a conexão voltar, mesmo depois de fechar o Orkio.
    </Alert>
  )
}

/** Última recusa do Notion / falha ao mover; `prefix` = nome do projeto no quadro de vários. */
export function BoardNoticeAlert({
  notice,
  prefix,
  onDismiss,
  onOpenIntegrations
}: {
  notice: BoardState['notice']
  prefix?: string
  onDismiss(): void
  onOpenIntegrations(): void
}): React.JSX.Element | null {
  if (!notice) return null
  return (
    <Alert
      tone="danger"
      action={
        <>
          {notice.canReconnect && (
            <Button size="sm" variant="ghost" onClick={onOpenIntegrations}>
              Ir para Integrações
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Fechar aviso
          </Button>
        </>
      }
    >
      {prefix ? `${prefix}: ${notice.message}` : notice.message}
    </Alert>
  )
}

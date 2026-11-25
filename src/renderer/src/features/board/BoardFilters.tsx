import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { SearchIcon } from '../../components/icons'
import { TASK_FILTERS, TASK_FILTER_TEXT, type TaskFilter } from '../../../../shared/task-lanes'

/**
 * Barra de filtros do quadro: situação (com a contagem de "Precisa de você"), busca e, em
 * `children`, os demais filtros (prioridade, "Só bloqueadas") e a linha das automações.
 */
export function BoardFilters({
  filter,
  attention,
  onFilter,
  query,
  onQuery,
  children
}: {
  filter: TaskFilter
  /** Quantas tarefas pedem atenção (antes da busca). */
  attention: number
  onFilter(filter: TaskFilter): void
  query: string
  onQuery(query: string): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Filtros do quadro"
      className="flex flex-wrap items-center gap-4 px-1"
    >
      <div className="flex items-center gap-1">
        {TASK_FILTERS.map((f) => (
          <Toggle
            key={f}
            size="sm"
            pressed={filter === f}
            onPressedChange={() => onFilter(f)}
            className="h-7 gap-1.5 px-2.5 text-xs data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-border"
          >
            {TASK_FILTER_TEXT[f]}
            {f === 'attention' && (
              <span className="tabular text-subtle-foreground" data-testid="attention-count">
                {attention}
              </span>
            )}
          </Toggle>
        ))}
      </div>
      <div className="relative w-64">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
        <Input
          type="search"
          aria-label="Buscar tarefas"
          placeholder="Filtrar por ID, título ou projeto"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="h-7 pl-7 text-xs"
        />
      </div>
      {children}
    </div>
  )
}

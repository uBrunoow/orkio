import { useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { isTextField } from '../../app/keys'
import { CloseIcon, SearchIcon } from '../../components/icons'
import { TASK_FILTERS, TASK_FILTER_TEXT, type TaskFilter } from '../../../../shared/task-lanes'
import type { BoardMode } from './board-model'

/**
 * Barra de filtros do quadro: situação (com a contagem de "Precisa de você"), busca e, em
 * `children`, os demais filtros (prioridade, "Só bloqueadas") e a linha das automações.
 */
export function BoardFilters({
  mode,
  filter,
  attention,
  onFilter,
  query,
  onQuery,
  children
}: {
  /** Com vários projetos (`roles`), a busca também casa pelo nome do projeto. */
  mode: BoardMode
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
      className="flex flex-wrap items-center gap-x-2 gap-y-2 px-1"
    >
      <div
        role="group"
        aria-label="Situação"
        className="flex h-7 items-center gap-0.5 rounded-md border border-border p-0.5"
      >
        {TASK_FILTERS.map((f) => (
          <Toggle
            key={f}
            size="sm"
            pressed={filter === f}
            onPressedChange={() => onFilter(f)}
            className="h-full min-w-0 gap-1.5 rounded-sm px-2.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground"
          >
            {TASK_FILTER_TEXT[f]}
            {f === 'attention' && <AttentionCount count={attention} />}
          </Toggle>
        ))}
      </div>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      <SearchField
        query={query}
        onQuery={onQuery}
        placeholder={
          mode === 'roles' ? 'Filtrar por ID, título ou projeto' : 'Filtrar por ID ou título'
        }
      />
      {children}
    </div>
  )
}

/** Com tarefas esperando, a contagem ganha o tom de aviso; zerada, recua para o cinza. */
function AttentionCount({ count }: { count: number }): React.JSX.Element {
  return (
    <span
      data-testid="attention-count"
      className={cn(
        'tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs leading-none font-medium',
        count > 0 ? 'bg-warn-tint text-warn ring-1 ring-warn-tint-border' : 'text-subtle-foreground'
      )}
    >
      {count}
    </span>
  )
}

/** Busca com atalho "/" (fora de campos de texto), Esc para limpar e botão de limpar. */
function SearchField({
  query,
  onQuery,
  placeholder
}: {
  query: string
  onQuery(query: string): void
  placeholder: string
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTextField(e.target)) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t?.closest('[role="dialog"],[role="menu"],[role="listbox"],.xterm')) return
      e.preventDefault()
      ref.current?.focus()
      ref.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="group/search relative w-56 transition-[width] duration-200 ease-out focus-within:w-72 has-[input:not(:placeholder-shown)]:w-72 motion-reduce:transition-none">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground transition-colors group-focus-within/search:text-muted-foreground" />
      <Input
        ref={ref}
        type="search"
        aria-label="Buscar tarefas"
        aria-keyshortcuts="/"
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault()
            e.stopPropagation()
            onQuery('')
          }
        }}
        className="h-7 pr-7 pl-7 text-xs [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => {
            onQuery('')
            ref.current?.focus()
          }}
          className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-subtle-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CloseIcon className="size-3" />
        </button>
      ) : (
        <Kbd className="absolute top-1/2 right-1.5 -translate-y-1/2 group-focus-within/search:hidden">
          /
        </Kbd>
      )}
    </div>
  )
}

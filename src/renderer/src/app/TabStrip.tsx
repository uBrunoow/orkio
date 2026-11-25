import { useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { CloseIcon, PlusIcon } from '../components/icons'
import { useSource } from '../lib/ipc'
import { formatKeys } from './keys'
import { SETTINGS_TITLES, type Route } from './routes'
import { screenOf } from './screens'
import { useSources } from './sources'
import type { Tab, TabsAction } from './tabs'

/** Título da aba: o da tela; a tarefa mostra ID e título (do quadro já carregado). */
function useTabTitle(route: Route): { id: string | null; title: string } {
  const { board } = useSources()
  const projectId = route.name === 'task' ? route.projectId : null
  const view = useSource(board, projectId).value?.view ?? null
  if (route.name === 'task') {
    const card = view?.cards.find((c) => c.taskId === route.taskId)
    return { id: card?.displayId ?? null, title: card?.title ?? 'Tarefa' }
  }
  if (route.name === 'settings' && route.section) {
    return { id: null, title: SETTINGS_TITLES[route.section] }
  }
  return { id: null, title: screenOf(route.name).title }
}

function TabItem({
  tab,
  index,
  isActive,
  dispatch,
  onDragStart,
  onDrop
}: {
  tab: Tab
  index: number
  isActive: boolean
  dispatch(action: TabsAction): void
  onDragStart(id: string): void
  onDrop(index: number): void
}): React.JSX.Element {
  const route = tab.router.route
  const { id, title } = useTabTitle(route)
  const Icon = screenOf(route.name).icon
  const name = id ? `${id} ${title}` : title
  const [over, setOver] = useState(false)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(tab.id)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onDrop(index)
      }}
      onAuxClick={(e) => {
        // Botão do meio fecha, como no navegador.
        if (e.button === 1) dispatch({ type: 'close', id: tab.id })
      }}
      className={cn(
        'group relative flex h-8 max-w-[220px] min-w-[120px] flex-1 items-center rounded-md border border-transparent text-sm',
        isActive
          ? 'border-border-soft bg-card text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        over && 'ring-1 ring-ring/40'
      )}
    >
      <button
        type="button"
        role="tab"
        id={`tab-${tab.id}`}
        aria-selected={isActive}
        aria-controls="tab-panel"
        tabIndex={isActive ? 0 : -1}
        onClick={() => dispatch({ type: 'activate', id: tab.id })}
        onKeyDown={(e) => {
          if (e.key === 'Delete') {
            e.preventDefault()
            dispatch({ type: 'close', id: tab.id })
          }
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Icon className="size-3.5 text-subtle-foreground" />
        {id && <span className="shrink-0 font-mono text-2xs text-subtle-foreground">{id}</span>}
        <span className="min-w-0 truncate">{title}</span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Fechar aba ${name}`}
        onClick={() => dispatch({ type: 'close', id: tab.id })}
        className={cn(
          'mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-subtle-foreground outline-none hover:bg-muted hover:text-foreground',
          !isActive && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        <CloseIcon className="size-3" />
      </button>
    </div>
  )
}

/**
 * Abas abertas (telas e tarefas). Clique ativa; botão do meio, × ou Delete fecha; arrastar
 * reordena; ←/→ andam entre as abas (padrão de abas do WAI-ARIA). "+" abre uma aba Início.
 */
export function TabStrip({
  tabs,
  activeId,
  isMac,
  dispatch
}: {
  tabs: readonly Tab[]
  activeId: string | null
  isMac: boolean
  dispatch(action: TabsAction): void
}): React.JSX.Element {
  const dragging = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const focusActive = (): void => {
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
    )
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-soft bg-background px-2">
      <div
        ref={list}
        role="tablist"
        aria-label="Abas abertas"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        onKeyDown={(e) => {
          if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.altKey && !e.ctrlKey) {
            e.preventDefault()
            dispatch({ type: 'cycle', offset: e.key === 'ArrowRight' ? 1 : -1 })
            focusActive()
          }
        }}
      >
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            index={i}
            isActive={tab.id === activeId}
            dispatch={dispatch}
            onDragStart={(id) => (dragging.current = id)}
            onDrop={(index) => {
              if (dragging.current) dispatch({ type: 'move', id: dragging.current, index })
              dragging.current = null
            }}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Nova aba"
            onClick={() => dispatch({ type: 'open' })}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <PlusIcon className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-2">
          Nova aba <Kbd>{formatKeys('mod+t', isMac)}</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

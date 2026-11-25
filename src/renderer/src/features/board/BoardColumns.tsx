import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { stageDotClass } from './stage-dot'
import {
  dropStageFor,
  taskKey,
  type BoardColumnDef,
  type BoardEntry,
  type BoardMode
} from './board-model'
import { ColumnCollapseIcon, ColumnExpandIcon } from '../../components/icons'
import { BoardCardBody, BoardCardItem, CARD_CLASS, type CardActions } from './BoardCardView'

/** Movimento mínimo (px) para virar arrasto: cliques e o menu do card continuam funcionando. */
const DRAG_THRESHOLD = 5

interface DragState {
  /** `entry.key` do card arrastado. */
  key: string
  width: number
  height: number
  offsetX: number
  offsetY: number
  x: number
  y: number
  target: string | null
}

/**
 * Colunas do quadro com arrasto por ponteiro (lógica do template `kanban-board`: posição do card
 * flutuante pela prop `style`, permitida pela CSP). Teclado/leitor de tela: menu "Mover para…" de
 * cada card.
 */
export function BoardColumns({
  mode,
  columns,
  entries,
  actionsFor
}: {
  mode: BoardMode
  columns: readonly BoardColumnDef[]
  /** Entradas visíveis (já filtradas). */
  entries: readonly BoardEntry[]
  actionsFor(projectId: string): CardActions
}): React.JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null)
  // Colunas recolhidas (só nesta sessão da tela): viram uma faixa estreita com nome e contagem.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleCollapsed = (id: string): void =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const columnEls = useRef(new Map<string, HTMLElement>())
  const cardEls = useRef(new Map<string, HTMLElement>())
  const teardown = useRef<(() => void) | null>(null)
  const showProject = mode === 'roles'

  const byColumn = useMemo(() => {
    const map = new Map<string, BoardEntry[]>(columns.map((c) => [c.id, []]))
    for (const entry of entries) map.get(entry.columnId)?.push(entry)
    return map
  }, [columns, entries])

  const dragged = drag ? entries.find((e) => e.key === drag.key) : undefined
  /** Destino do card arrastado nesta coluna; `null` = não dá para soltar ali. */
  const dropTarget = (entry: BoardEntry, columnId: string): string | null =>
    dropStageFor(entry, columnId, mode)

  function targetAt(x: number, y: number): string | null {
    for (const [id, el] of columnEls.current) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id
    }
    return null
  }

  function onPointerDown(e: React.PointerEvent, key: string): void {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"], [role="menu"]')) return
    const el = cardEls.current.get(key)
    const entry = entries.find((x) => x.key === key)
    if (!el || !entry) return
    const rect = el.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    let started = false
    let target: string | null = null

    const onMove = (ev: PointerEvent): void => {
      if (
        !started &&
        Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
      ) {
        return
      }
      started = true
      target = targetAt(ev.clientX, ev.clientY)
      setDrag({
        key,
        width: rect.width,
        height: rect.height,
        offsetX: startX - rect.left,
        offsetY: startY - rect.top,
        x: ev.clientX,
        y: ev.clientY,
        target
      })
    }
    const onUp = (): void => {
      teardown.current?.()
      const { projectId, card } = entry
      const stageId = started && target ? dropTarget(entry, target) : null
      if (stageId && stageId !== card.stageId) actionsFor(projectId).onMove(card.taskId, stageId)
      if (!started) actionsFor(projectId).onOpen(card.taskId)
      setDrag(null)
    }
    teardown.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      teardown.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => () => teardown.current?.(), [])

  /** Teclado no quadro: J/K ou ↑/↓ no card ao lado, ←/→ na coluna ao lado, M abre o menu. */
  function onKeyDown(e: React.KeyboardEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-task-id]')
    if (!el || e.target !== el || e.altKey || e.shiftKey) return
    const taskId = el.dataset['taskId'] ?? ''
    const projectId = el.dataset['projectId'] ?? ''
    const key = taskKey(projectId, taskId)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      actionsFor(projectId).onOpen(taskId)
      return
    }
    if (e.ctrlKey || e.metaKey) return
    const grid = columns.map((c) => (collapsed.has(c.id) ? [] : (byColumn.get(c.id) ?? [])))
    const col = grid.findIndex((list) => list.some((x) => x.key === key))
    const row = grid[col]?.findIndex((x) => x.key === key) ?? -1
    if (col < 0 || row < 0) return
    let next: BoardEntry | undefined
    const pressed = e.key.toLowerCase()
    if (pressed === 'j' || pressed === 'arrowdown') next = grid[col]?.[row + 1]
    else if (pressed === 'k' || pressed === 'arrowup') next = grid[col]?.[row - 1]
    else if (pressed === 'arrowleft' || pressed === 'arrowright') {
      const step = pressed === 'arrowleft' ? -1 : 1
      for (let c = col + step; c >= 0 && c < grid.length; c += step) {
        const list = grid[c] ?? []
        if (list.length > 0) {
          next = list[Math.min(row, list.length - 1)]
          break
        }
      }
    } else if (pressed === 'm') {
      e.preventDefault()
      // O gatilho do Radix abre no pointerdown ou no teclado (não no .click()): manda um Enter.
      const trigger = el.querySelector<HTMLButtonElement>('button[aria-label^="Ações de"]')
      trigger?.focus()
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return
    } else return
    e.preventDefault()
    if (next) cardEls.current.get(next.key)?.focus()
  }

  return (
    <>
      <div
        role="list"
        aria-label="Etapas do quadro"
        aria-keyshortcuts="J K ArrowLeft ArrowRight M Control+Enter"
        onKeyDown={onKeyDown}
        className="flex h-full min-h-0 items-stretch gap-2.5 overflow-x-auto overflow-y-hidden pb-2"
      >
        {columns.map((column) => {
          const items = byColumn.get(column.id) ?? []
          const visible = drag ? items.filter((x) => x.key !== drag.key) : items
          // Durante o arraste, coluna sem destino para o card (ex.: Sem etapa, Outras etapas).
          const blocked = dragged ? dropTarget(dragged, column.id) === null : false
          const isTarget = drag?.target === column.id && !blocked
          const dropAttrs = blocked
            ? { 'aria-disabled': true as const, 'data-drop': 'blocked' }
            : {}
          const setColumnEl = (el: HTMLDivElement | null): void => {
            if (el) columnEls.current.set(column.id, el)
            else columnEls.current.delete(column.id)
          }
          const dot = column.stage ? stageDotClass(column.stage) : 'bg-warn'
          if (collapsed.has(column.id)) {
            return (
              <div
                key={column.id}
                ref={setColumnEl}
                role="listitem"
                aria-label={column.name}
                data-stage-id={column.id}
                data-collapsed="true"
                {...dropAttrs}
                className={cn(
                  'flex h-full w-9 shrink-0 flex-col items-center gap-2 rounded-[9px] border border-border-soft py-1.5',
                  isTarget ? 'bg-muted' : 'bg-surface'
                )}
              >
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Expandir ${column.name}`}
                  onClick={() => toggleCollapsed(column.id)}
                >
                  <ColumnExpandIcon />
                </Button>
                <span aria-hidden="true" className={cn('size-[7px] rounded-full', dot)} />
                <span
                  className="tabular font-mono text-2xs text-subtle-foreground"
                  data-testid="column-count"
                >
                  {items.length}
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground [writing-mode:vertical-rl]">
                  {column.name}
                </span>
              </div>
            )
          }
          return (
            <div
              key={column.id}
              ref={setColumnEl}
              role="listitem"
              aria-label={column.name}
              data-stage-id={column.id}
              {...dropAttrs}
              className={cn(
                'group/col flex h-full w-[268px] shrink-0 flex-col gap-1.5 rounded-xl border p-1.5 transition-colors motion-reduce:transition-none',
                isTarget ? 'border-brand/40 bg-muted/70' : 'border-border-soft bg-surface/60'
              )}
            >
              <div className="flex min-w-0 items-center gap-2 px-1.5 pt-1 pb-1 text-muted-foreground">
                <span aria-hidden="true" className={cn('size-[7px] shrink-0 rounded-full', dot)} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h3 className="shrink-0 text-sm font-normal whitespace-nowrap text-muted-foreground">
                      {column.name}
                    </h3>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {column.hint}
                  </TooltipContent>
                </Tooltip>
                <span
                  className="tabular shrink-0 text-sm text-subtle-foreground"
                  data-testid="column-count"
                >
                  {items.length}
                </span>
                <span className="ml-auto min-w-0 truncate text-right font-mono text-[10.5px] text-subtle-foreground">
                  {column.aside}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Recolher ${column.name}`}
                  className="-my-1 opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100"
                  onClick={() => toggleCollapsed(column.id)}
                >
                  <ColumnCollapseIcon />
                </Button>
              </div>
              <div
                role="list"
                aria-label={`Tarefas em ${column.name}`}
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5"
              >
                {visible.map((entry) => (
                  <BoardCardItem
                    key={entry.key}
                    entry={entry}
                    showProject={showProject}
                    actions={actionsFor(entry.projectId)}
                    cardRef={(el) => {
                      if (el) cardEls.current.set(entry.key, el)
                      else cardEls.current.delete(entry.key)
                    }}
                    onPointerDown={onPointerDown}
                  />
                ))}
                {isTarget && drag && (
                  <div
                    aria-hidden="true"
                    className="shrink-0 rounded-[9px] border border-dashed border-border bg-muted/40"
                    style={{ height: drag.height }}
                  />
                )}
                {visible.length === 0 && !isTarget && (
                  <p className="px-1.5 py-1 text-xs text-subtle-foreground">Nenhuma tarefa</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {drag && dragged && (
        <div
          aria-hidden="true"
          className={cn(
            CARD_CLASS,
            'pointer-events-none fixed top-0 left-0 z-[1000] cursor-grabbing border-brand shadow-xl'
          )}
          style={{
            width: drag.width,
            transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`
          }}
        >
          <BoardCardBody entry={dragged} showProject={showProject} actions={null} />
        </div>
      )}
    </>
  )
}

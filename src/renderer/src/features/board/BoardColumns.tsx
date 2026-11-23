import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { tokenColor } from '../notion-workspace/notion-colors'
import type { BoardCard, BoardStage, TaskSignals } from '../../../../shared/ipc-contract'
import { ColumnCollapseIcon, ColumnExpandIcon } from '../../components/icons'
import { BoardCardBody, BoardCardItem, CARD_CLASS, type CardActions } from './BoardCardView'

/** Movimento mínimo (px) para virar arrasto: cliques e o menu do card continuam funcionando. */
const DRAG_THRESHOLD = 5
/** Coluna "Sem etapa" (status do Notion que nenhuma etapa usa). Não aceita cards. */
export const NO_STAGE = '__sem-etapa__'

interface DragState {
  taskId: string
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
  stages,
  cards,
  signals,
  selectedTaskId,
  actions,
  endInset = null
}: {
  stages: readonly BoardStage[]
  cards: readonly BoardCard[]
  signals: Record<string, TaskSignals>
  selectedTaskId: string | null
  actions: CardActions
  /**
   * Largura da folha da tarefa aberta sobre as colunas: um espaço no fim do quadro, para dar para
   * rolar as últimas colunas (e a "Sem etapa") para fora de baixo da folha.
   */
  endInset?: string | null
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

  const byColumn = useMemo(() => {
    const map = new Map<string, BoardCard[]>(stages.map((s) => [s.id, []]))
    map.set(NO_STAGE, [])
    for (const card of cards) {
      const key = card.stageId && map.has(card.stageId) ? card.stageId : NO_STAGE
      map.get(key)!.push(card)
    }
    return map
  }, [stages, cards])

  const columns: { id: string; name: string; stage: BoardStage | null }[] = [
    ...stages.map((s) => ({ id: s.id, name: s.name, stage: s })),
    ...((byColumn.get(NO_STAGE)?.length ?? 0) > 0
      ? [{ id: NO_STAGE, name: 'Sem etapa', stage: null }]
      : [])
  ]

  function targetAt(x: number, y: number): string | null {
    for (const [id, el] of columnEls.current) {
      if (id === NO_STAGE) continue
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id
    }
    return null
  }

  function onPointerDown(e: React.PointerEvent, taskId: string): void {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"], [role="menu"]')) return
    const el = cardEls.current.get(taskId)
    if (!el) return
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
        taskId,
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
      const card = cards.find((c) => c.taskId === taskId)
      if (started && target && card && card.stageId !== target) actions.onMove(taskId, target)
      // Clique simples (sem arrasto) abre os detalhes.
      if (!started) actions.onOpen(taskId)
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      actions.onExpand?.(taskId)
      return
    }
    if (e.ctrlKey || e.metaKey) return
    const grid = columns.map((c) => (collapsed.has(c.id) ? [] : (byColumn.get(c.id) ?? [])))
    const col = grid.findIndex((list) => list.some((c) => c.taskId === taskId))
    const row = grid[col]?.findIndex((c) => c.taskId === taskId) ?? -1
    if (col < 0 || row < 0) return
    let next: BoardCard | undefined
    const key = e.key.toLowerCase()
    if (key === 'j' || key === 'arrowdown') next = grid[col]?.[row + 1]
    else if (key === 'k' || key === 'arrowup') next = grid[col]?.[row - 1]
    else if (key === 'arrowleft' || key === 'arrowright') {
      const step = key === 'arrowleft' ? -1 : 1
      for (let c = col + step; c >= 0 && c < grid.length; c += step) {
        const list = grid[c] ?? []
        if (list.length > 0) {
          next = list[Math.min(row, list.length - 1)]
          break
        }
      }
    } else if (key === 'm') {
      e.preventDefault()
      el.querySelector<HTMLButtonElement>('button[aria-label^="Ações de"]')?.click()
      return
    } else return
    e.preventDefault()
    if (next) cardEls.current.get(next.taskId)?.focus()
  }

  const dragged = drag ? cards.find((c) => c.taskId === drag.taskId) : undefined

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
          const visible = drag ? items.filter((c) => c.taskId !== drag.taskId) : items
          const isTarget = drag?.target === column.id
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
              // Colunas não encolhem: o quadro rola na horizontal.
              className={cn(
                'group/col flex h-full w-[268px] shrink-0 flex-col gap-2 rounded-[10px] transition-colors',
                isTarget && 'bg-muted/60'
              )}
            >
              <div className="flex min-w-0 items-center gap-2 px-1 pt-1 pb-1.5 text-muted-foreground">
                <span aria-hidden="true" className={cn('size-[7px] shrink-0 rounded-full', dot)} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* O nome da coluna não quebra nem encolhe; o status do Notion encolhe. */}
                    <h3 className="shrink-0 text-sm font-normal whitespace-nowrap text-muted-foreground">
                      {column.name}
                    </h3>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {column.stage
                      ? `Status no Notion: ${column.stage.notionStatus.name}`
                      : 'Status do Notion que nenhuma etapa usa'}
                  </TooltipContent>
                </Tooltip>
                <span
                  className="tabular shrink-0 text-sm text-subtle-foreground"
                  data-testid="column-count"
                >
                  {items.length}
                </span>
                <span className="ml-auto min-w-0 truncate text-right font-mono text-[10.5px] text-subtle-foreground">
                  {column.stage ? `Notion: ${column.stage.notionStatus.name}` : 'Sem etapa'}
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
                {visible.map((card) => (
                  <BoardCardItem
                    key={card.taskId}
                    card={card}
                    stages={stages}
                    signals={signals[card.taskId]}
                    actions={actions}
                    isSelected={selectedTaskId === card.taskId}
                    cardRef={(el) => {
                      if (el) cardEls.current.set(card.taskId, el)
                      else cardEls.current.delete(card.taskId)
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
                  <p className="px-1 text-xs text-subtle-foreground">Nenhuma tarefa</p>
                )}
              </div>
            </div>
          )
        })}
        {endInset && <div aria-hidden="true" className="shrink-0" style={{ width: endInset }} />}
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
          <BoardCardBody
            card={dragged}
            stages={stages}
            signals={signals[dragged.taskId]}
            actions={null}
          />
        </div>
      )}
    </>
  )
}

/** Ponto da coluna com a cor escolhida para a etapa (Etapas e automações); sem cor, neutro. */
export function stageDotColor(
  stage: Pick<BoardStage, 'color'>
): 'tertiary' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray' {
  const c = stage.color ? tokenColor(stage.color) : 'default'
  return c === 'default' ? 'tertiary' : c
}

/**
 * Classe de fundo do ponto da etapa. O tema não tem roxo nem rosa: roxo usa o azul de informação e
 * rosa o vermelho de perigo.
 */
const DOT_BG: Record<ReturnType<typeof stageDotColor>, string> = {
  tertiary: 'bg-subtle-foreground',
  gray: 'bg-muted-foreground',
  red: 'bg-danger',
  orange: 'bg-brand',
  yellow: 'bg-warn',
  green: 'bg-ok',
  blue: 'bg-info',
  purple: 'bg-purple',
  pink: 'bg-pink'
}

export function stageDotClass(stage: Pick<BoardStage, 'color'>): string {
  return DOT_BG[stageDotColor(stage)]
}

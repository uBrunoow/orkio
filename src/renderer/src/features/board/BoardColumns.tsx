import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Heading } from '@astryxdesign/core/Heading'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { Tooltip } from '@astryxdesign/core/Tooltip'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardCard, BoardStage, TaskSignals } from '../../../../shared/ipc-contract'
import { BoardCardBody, BoardCardItem, type CardActions } from './BoardCardView'

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
 * Colunas do quadro com arrasto por ponteiro (lógica do template `kanban-board` da Astryx, sem
 * StyleX: posição do card flutuante pela prop `style`, permitida pela CSP). Teclado/leitor de
 * tela: menu "Mover para…" de cada card.
 */
export function BoardColumns({
  stages,
  cards,
  signals,
  selectedTaskId,
  actions
}: {
  stages: readonly BoardStage[]
  cards: readonly BoardCard[]
  signals: Record<string, TaskSignals>
  selectedTaskId: string | null
  actions: CardActions
}): React.JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null)
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
    const grid = columns.map((c) => byColumn.get(c.id) ?? [])
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
      <HStack
        gap={4}
        vAlign="stretch"
        role="list"
        aria-label="Etapas do quadro"
        aria-keyshortcuts="J K ArrowLeft ArrowRight M Control+Enter"
        onKeyDown={onKeyDown}
        isScrollable
        height="100%"
        paddingBlockEnd={2}
      >
        {columns.map((column) => {
          const items = byColumn.get(column.id) ?? []
          const visible = drag ? items.filter((c) => c.taskId !== drag.taskId) : items
          const isTarget = drag?.target === column.id
          return (
            <VStack
              key={column.id}
              role="listitem"
              aria-label={column.name}
              data-stage-id={column.id}
              width="calc(var(--spacing-12) * 6)"
              height="100%"
              // Colunas não encolhem: o quadro rola na horizontal.
              style={{ flexShrink: 0 }}
            >
              <Card variant={isTarget ? 'default' : 'muted'} padding={0} height="100%">
                <VStack
                  ref={(el: HTMLDivElement | null) => {
                    if (el) columnEls.current.set(column.id, el)
                    else columnEls.current.delete(column.id)
                  }}
                  height="100%"
                >
                  <HStack gap={2} vAlign="center" padding={3} paddingBlockEnd={1}>
                    <StatusDot
                      variant={column.stage ? 'neutral' : 'warning'}
                      label={column.stage ? `Etapa ${column.name}` : 'Sem etapa'}
                    />
                    <Tooltip
                      content={
                        column.stage
                          ? `Status no Notion: ${column.stage.notionStatus.name}`
                          : 'Status do Notion que nenhuma etapa usa'
                      }
                      placement="below"
                      alignment="start"
                    >
                      <Heading level={3}>{column.name}</Heading>
                    </Tooltip>
                    <StackItem size="fill" />
                    <Text type="supporting" hasTabularNumbers data-testid="column-count">
                      {items.length}
                    </Text>
                  </HStack>
                  <StackItem size="fill">
                    <ScrollableArea
                      label={`Tarefas em ${column.name} (rolagem)`}
                      height="100%"
                      padding={3}
                      paddingBlockStart={2}
                    >
                      <VStack gap={2} role="list" aria-label={`Tarefas em ${column.name}`}>
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
                          <Card variant="muted" height={drag.height} aria-hidden />
                        )}
                        {visible.length === 0 && !isTarget && (
                          <Text type="supporting" color="secondary">
                            Nenhuma tarefa
                          </Text>
                        )}
                      </VStack>
                    </ScrollableArea>
                  </StackItem>
                </VStack>
              </Card>
            </VStack>
          )
        })}
      </HStack>
      {drag && dragged && (
        <Card
          padding={3}
          aria-hidden
          style={{
            position: 'fixed',
            insetBlockStart: 0,
            insetInlineStart: 0,
            width: drag.width,
            transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`,
            pointerEvents: 'none',
            cursor: 'grabbing',
            boxShadow: 'var(--shadow-high)',
            zIndex: 1000
          }}
        >
          <BoardCardBody
            card={dragged}
            stages={stages}
            signals={signals[dragged.taskId]}
            actions={null}
          />
        </Card>
      )}
    </>
  )
}

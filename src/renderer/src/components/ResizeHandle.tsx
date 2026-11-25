import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const STEP = 24

/** Lê a largura salva (só deste computador); fora dos limites ou sem armazenamento = padrão. */
function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(window.localStorage.getItem(key))
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback
  } catch {
    return fallback
  }
}

/**
 * Largura de um painel que a pessoa ajusta arrastando a borda (ou com as setas no divisor).
 * Guardada em `localStorage` com a chave dada; dois cliques no divisor voltam ao padrão.
 */
export function usePanelWidth(
  key: string,
  { initial, min, max }: { initial: number; min: number; max: number }
): { width: number; set(width: number): void; reset(): void; min: number; max: number } {
  const [width, setWidth] = useState(() => readWidth(key, initial, min, max))
  const set = useCallback(
    (next: number) => {
      const w = Math.round(Math.min(max, Math.max(min, next)))
      setWidth(w)
      try {
        window.localStorage.setItem(key, String(w))
      } catch {
        // Sem armazenamento: vale até fechar o app.
      }
    },
    [key, min, max]
  )
  const reset = useCallback(() => set(initial), [set, initial])
  // A janela diminuiu: o painel cabe no limite novo sem perder a largura escolhida.
  return { width: Math.min(max, Math.max(min, width)), set, reset, min, max }
}

/**
 * Divisor vertical arrastável entre o conteúdo e um painel à direita: arrastar para a esquerda
 * aumenta o painel. Com foco, ← e → ajustam; Home/End vão aos limites.
 */
export function ResizeHandle({
  label,
  panel,
  className
}: {
  label: string
  panel: ReturnType<typeof usePanelWidth>
  className?: string
}): React.JSX.Element {
  const start = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      aria-valuenow={panel.width}
      tabIndex={0}
      title="Arraste para mudar a largura · dois cliques voltam ao padrão"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width: panel.width }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        panel.set(start.current.width + (start.current.x - e.clientX))
      }}
      onPointerUp={(e) => {
        start.current = null
        setDragging(false)
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onDoubleClick={panel.reset}
      onKeyDown={(e) => {
        const by = e.shiftKey ? STEP * 3 : STEP
        if (e.key === 'ArrowLeft') panel.set(panel.width + by)
        else if (e.key === 'ArrowRight') panel.set(panel.width - by)
        else if (e.key === 'Home') panel.set(panel.max)
        else if (e.key === 'End') panel.set(panel.min)
        else return
        e.preventDefault()
      }}
      className={cn(
        'group/resize relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-soft transition-colors motion-reduce:transition-none group-hover/resize:w-0.5 group-hover/resize:bg-brand/60 group-focus-visible/resize:w-0.5 group-focus-visible/resize:bg-brand',
          dragging && 'w-0.5 bg-brand'
        )}
      />
    </div>
  )
}

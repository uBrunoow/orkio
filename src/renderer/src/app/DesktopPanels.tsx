import { cn } from '@/lib/utils'
import type { Arrangement } from './desktops'

export interface Panel {
  /** Id da aba (o painel é o `tabpanel` dela). */
  id: string
  active: boolean
  content: React.ReactNode
}

/** Grade de cada arranjo pelo número de painéis (classes literais para o Tailwind). */
function gridClass(arrangement: Arrangement, n: number): string {
  if (n <= 1 || arrangement === 'single') return 'grid-cols-1'
  switch (arrangement) {
    case 'columns':
      return n === 2 ? 'grid-cols-2' : 'grid-cols-3'
    case 'main-stack':
      return n === 2 ? 'grid-cols-[3fr_2fr]' : 'grid-cols-[3fr_2fr] grid-rows-2'
    case 'grid':
      return n === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'
  }
}

function cellClass(arrangement: Arrangement, n: number, i: number): string | false {
  if (arrangement === 'main-stack' && n === 3 && i === 0) return 'row-span-2'
  if (arrangement === 'grid' && n === 3 && i === 2) return 'col-span-2'
  return false
}

/**
 * Painéis das abas visíveis do desktop (divisão lado a lado). Clicar ou usar o teclado num painel
 * o torna o ativo (a aba ativa), marcado por uma linha laranja no topo; com um painel só, nada
 * muda em relação a uma aba por vez.
 */
export function DesktopPanels({
  arrangement,
  panels,
  onActivate
}: {
  arrangement: Arrangement
  panels: readonly Panel[]
  onActivate(id: string): void
}): React.JSX.Element {
  const split = panels.length > 1
  return (
    <div
      data-testid="desktop-panels"
      data-arrangement={arrangement}
      className={cn(
        'grid min-h-0 flex-1 gap-px bg-border-soft',
        gridClass(arrangement, panels.length)
      )}
    >
      {panels.map((p, i) => (
        <div
          key={p.id}
          id={`tab-panel-${p.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${p.id}`}
          data-active={split ? p.active : undefined}
          className={cn(
            'relative min-h-0 min-w-0 overflow-hidden bg-background',
            cellClass(arrangement, panels.length, i)
          )}
          onPointerDownCapture={() => !p.active && onActivate(p.id)}
          onKeyDownCapture={() => !p.active && onActivate(p.id)}
          onFocusCapture={(e) => {
            // Tab do teclado vindo de fora do painel ativa este. Foco devolvido por um diálogo
            // ou menu que fechou (a paleta, o menu Janela) não: o comando já escolheu a aba.
            const from = e.relatedTarget
            if (p.active || !(from instanceof Element) || e.currentTarget.contains(from)) return
            if (from.closest('[role="dialog"],[role="menu"],[role="menubar"],[role="listbox"]'))
              return
            onActivate(p.id)
          }}
        >
          {p.content}
          {split && p.active && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-brand"
            />
          )}
        </div>
      ))}
    </div>
  )
}

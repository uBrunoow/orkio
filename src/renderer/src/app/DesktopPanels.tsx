import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { LayoutPrefs } from '../features/settings/layout-prefs'
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

/** Entrada do desktop pela transição escolhida (classes do tw-animate-css; movimento reduzido zera). */
function enterClass(transition: LayoutPrefs['transition'], direction: 1 | -1 | 0): string | false {
  if (direction === 0 || transition === 'instant') return false
  if (transition === 'fade') return 'animate-in fade-in-0 duration-200'
  return cn(
    'animate-in fade-in-0 duration-200 ease-out',
    direction > 0 ? 'slide-in-from-right-6' : 'slide-in-from-left-6'
  )
}

/**
 * Painéis das abas visíveis do desktop (divisão lado a lado). Clicar ou usar o teclado num painel
 * o torna o ativo (a aba ativa), marcado por uma linha laranja no topo; com um painel só, nada
 * muda em relação a uma aba por vez. Configurações › Layout escolhe o respiro entre painéis, o
 * foco pelo ponteiro e a transição ao trocar de desktop (da direção do desktop novo).
 */
export function DesktopPanels({
  desktopId,
  desktopIndex,
  arrangement,
  panels,
  layout,
  onActivate
}: {
  desktopId: string
  desktopIndex: number
  arrangement: Arrangement
  panels: readonly Panel[]
  layout: LayoutPrefs
  onActivate(id: string): void
}): React.JSX.Element {
  const split = panels.length > 1
  // Respiro só faz sentido com mais de um painel.
  const spaced = split && layout.gap === 'spaced'
  // Direção da troca: comparada com o desktop do desenho anterior (0 = mesmo desktop / abrindo).
  const [seen, setSeen] = useState({
    id: desktopId,
    index: desktopIndex,
    direction: 0 as 1 | -1 | 0
  })
  let direction = seen.direction
  if (seen.id !== desktopId) {
    direction = desktopIndex >= seen.index ? 1 : -1
    setSeen({ id: desktopId, index: desktopIndex, direction })
  }
  return (
    <div
      key={desktopId}
      data-testid="desktop-panels"
      data-arrangement={arrangement}
      data-gap={layout.gap}
      className={cn(
        'grid min-h-0 flex-1',
        spaced ? 'orkio-wallpaper gap-2 p-2' : 'gap-px bg-border-soft',
        gridClass(arrangement, panels.length),
        enterClass(layout.transition, direction)
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
            'relative min-h-0 min-w-0 overflow-hidden',
            spaced
              ? 'rounded-lg border border-border-soft bg-background/80 shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_6%,transparent)]'
              : 'orkio-wallpaper',
            cellClass(arrangement, panels.length, i)
          )}
          onPointerDownCapture={() => !p.active && onActivate(p.id)}
          onPointerEnter={() => layout.focus === 'hover' && split && !p.active && onActivate(p.id)}
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

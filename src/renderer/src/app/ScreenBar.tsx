import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Barra fina no topo de cada tela (48 px, mockup): à esquerda o caminho e o que a tela põe ali
 * (título, Kanban/Lista, fases da tarefa); à direita as ações da tela (sino e conta ficam na barra
 * do app, Fase 0). A tela
 * preenche os encaixes com `<ScreenBarStart>`/`<ScreenBarEnd>` (portal), sem conhecer o App.
 */
interface Slots {
  start: HTMLElement | null
  end: HTMLElement | null
}

const SlotsContext = createContext<Slots>({ start: null, end: null })

export function ScreenBarStart({ children }: { children: React.ReactNode }): React.ReactNode {
  const { start } = useContext(SlotsContext)
  return start ? createPortal(children, start) : null
}

export function ScreenBarEnd({ children }: { children: React.ReactNode }): React.ReactNode {
  const { end } = useContext(SlotsContext)
  return end ? createPortal(children, end) : null
}

export type Crumb = string | { label: string; onClick?: (() => void) | undefined }

export function CrumbLink({
  label,
  onClick
}: {
  label: string
  onClick?: (() => void) | undefined
}): React.JSX.Element {
  if (!onClick) return <span>{label}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {label}
    </button>
  )
}

export function Crumbs({ parts }: { parts: readonly Crumb[] }): React.JSX.Element {
  const items = parts.map((p) => (typeof p === 'string' ? { label: p } : p))
  const last = items.at(-1)
  return (
    <nav aria-label="Caminho" className="min-w-0 truncate text-sm text-muted-foreground">
      {items.slice(0, -1).map((p, i) => (
        <span key={i}>
          <CrumbLink label={p.label} onClick={p.onClick} />
          <span aria-hidden="true"> › </span>
        </span>
      ))}
      <span aria-current="page" className="font-medium text-foreground">
        {last?.label}
      </span>
    </nav>
  )
}

export function ScreenFrame({
  crumbs,
  children
}: {
  /** Caminho padrão; uma tela que põe o próprio título no encaixe pode passar `null`. */
  crumbs: readonly Crumb[] | null
  children: React.ReactNode
}): React.JSX.Element {
  const [start, setStart] = useState<HTMLElement | null>(null)
  const [end, setEnd] = useState<HTMLElement | null>(null)
  return (
    <SlotsContext.Provider value={{ start, end }}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div
          data-testid="top-bar"
          className="flex h-12 shrink-0 items-center gap-3 border-b border-border-soft px-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {crumbs && <Crumbs parts={crumbs} />}
            <div ref={setStart} className="flex min-w-0 items-center gap-3" />
          </div>
          <div ref={setEnd} className="flex shrink-0 items-center gap-2" />
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </SlotsContext.Provider>
  )
}

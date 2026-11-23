import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Barra fina no topo de cada tela (48 px, mockup): à esquerda o caminho e o que a tela põe ali
 * (título, Kanban/Lista, fases da tarefa); à direita as ações da tela, o sino e a conta. A tela
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

/** Caminho em cinza ("Configurações › Integrações"); o último trecho em branco, peso médio. */
export function Crumbs({ parts }: { parts: readonly string[] }): React.JSX.Element {
  const last = parts.at(-1)
  return (
    <p className="min-w-0 truncate text-sm text-muted-foreground">
      {parts.slice(0, -1).map((p) => `${p} › `)}
      <span className="font-medium text-foreground">{last}</span>
    </p>
  )
}

/** Moldura do conteúdo: a barra (caminho padrão do App + encaixes) e a tela embaixo. */
export function ScreenFrame({
  crumbs,
  bell,
  children
}: {
  /** Caminho padrão; uma tela que põe o próprio título no encaixe pode passar `null`. */
  crumbs: readonly string[] | null
  bell: React.ReactNode
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
          {bell}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </SlotsContext.Provider>
  )
}

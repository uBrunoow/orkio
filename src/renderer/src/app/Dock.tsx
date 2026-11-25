import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { MoonIcon, SidebarIcon, SunIcon } from '../components/icons'
import { appearancePref, resolvedTheme } from '../features/settings/appearance'
import { ariaKeys, formatKeys } from './keys'
import type { Route } from './routes'
import { dockScreens, type ScreenDef } from './screens'

/** A tela está aberta? A tarefa conta como Quadro (é de onde ela vem). */
function isCurrent(screen: ScreenDef, route: Route | null): boolean {
  if (!route) return false
  return route.name === screen.name || (screen.name === 'board' && route.name === 'task')
}

function DockButton({
  screen,
  route,
  isMac,
  onOpen
}: {
  screen: ScreenDef
  route: Route | null
  isMac: boolean
  onOpen(screen: ScreenDef): void
}): React.JSX.Element {
  const current = isCurrent(screen, route)
  const Icon = screen.icon
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={screen.title}
            aria-current={current ? 'page' : undefined}
            {...(screen.keys ? { 'aria-keyshortcuts': ariaKeys(screen.keys, isMac) } : {})}
            onClick={() => onOpen(screen)}
            className={cn(
              'relative flex size-9 items-center justify-center rounded-lg text-subtle-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
              current && 'bg-sidebar-accent text-foreground'
            )}
          >
            {current && (
              <span
                aria-hidden="true"
                className="absolute top-2 bottom-2 -left-[7px] w-[3px] rounded-r-full bg-brand"
              />
            )}
            <Icon className="size-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {screen.title}
          {screen.keys && <Kbd>{formatKeys(screen.keys, isMac)}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

/**
 * Troca rápida entre claro e escuro (acima das Configurações). Com o tema "Sistema", troca para o
 * oposto do que está na tela e passa a valer só o escolhido; Aparência volta ao "Sistema".
 */
function ThemeToggle(): React.JSX.Element {
  const appearance = appearancePref.use()
  const dark = resolvedTheme(appearance.theme) === 'dark'
  const label = dark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'
  const Icon = dark ? SunIcon : MoonIcon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => appearancePref.save({ ...appearance, theme: dark ? 'light' : 'dark' })}
          className="flex size-9 items-center justify-center rounded-lg text-subtle-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Icon className="size-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Dock: as telas do app num trilho fino à esquerda (do registro `screens.ts`), com o atalho no
 * tooltip; no pé, trocar o tema, Configurações e mostrar/esconder a lista de tarefas.
 */
export function Dock({
  route,
  isMac,
  sidebarOpen,
  onOpen,
  onToggleSidebar
}: {
  route: Route | null
  isMac: boolean
  sidebarOpen: boolean
  onOpen(screen: ScreenDef): void
  onToggleSidebar(): void
}): React.JSX.Element {
  const button = (s: ScreenDef): React.JSX.Element => (
    <DockButton key={s.name} screen={s} route={route} isMac={isMac} onOpen={onOpen} />
  )
  const toggleLabel = sidebarOpen ? 'Esconder lista de tarefas' : 'Mostrar lista de tarefas'
  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-background py-2">
      <div role="group" aria-label="Telas" className="flex min-h-0 flex-1 flex-col">
        <ul className="flex flex-col items-center gap-1">{dockScreens('main').map(button)}</ul>
        <div className="mt-auto flex flex-col items-center gap-1">
          <ThemeToggle />
          <ul className="flex flex-col items-center gap-1">{dockScreens('bottom').map(button)}</ul>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={toggleLabel}
            aria-pressed={sidebarOpen}
            aria-keyshortcuts={ariaKeys('mod+b', isMac)}
            onClick={onToggleSidebar}
            className="flex size-9 items-center justify-center rounded-lg text-subtle-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <SidebarIcon className="size-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {toggleLabel}
          <Kbd>{formatKeys('mod+b', isMac)}</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

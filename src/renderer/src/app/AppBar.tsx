import { Kbd } from '@/components/ui/kbd'
import { OrkioLogo } from '../components/OrkioLogo/OrkioLogo'
import { SearchIcon } from '../components/icons'
import { useUpdates } from '../features/settings/useUpdates'
import { formatKeys } from './keys'

/**
 * Barra do app (Fase 0): marca e versão, os menus (Sessão, Ir, Janela, Ajuda) à esquerda; à
 * direita o que vale para o app todo: uso do Claude, a paleta, o sino e a conta.
 */
export function AppBar({
  menus,
  meter,
  bell,
  account,
  isMac,
  onPalette
}: {
  menus: React.ReactNode
  meter: React.ReactNode
  bell: React.ReactNode
  account: React.ReactNode
  isMac: boolean
  onPalette(): void
}): React.JSX.Element {
  const version = useUpdates().status?.currentVersion ?? null
  return (
    <header
      data-testid="app-bar"
      className="flex h-11 shrink-0 items-center gap-3 border-b border-border-soft bg-background pr-3 pl-3.5"
    >
      <div className="flex items-center gap-2">
        <OrkioLogo variant="simple" withWordmark size={16} />
        {version && (
          <span
            aria-label={`Versão ${version}`}
            className="rounded-sm border border-border px-1.5 py-px font-mono text-[10px] text-subtle-foreground"
          >
            v{version}
          </span>
        )}
      </div>
      <span aria-hidden="true" className="h-4 w-px bg-border-soft" />
      {menus}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {meter}
        <button
          type="button"
          onClick={onPalette}
          aria-label="Paleta de comandos"
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          className="flex h-7 items-center gap-2 rounded-md border border-border px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <SearchIcon className="size-3.5" />
          <span className="hidden lg:inline">Fazer qualquer coisa</span>
          <Kbd aria-hidden="true">{formatKeys('mod+k', isMac)}</Kbd>
        </button>
        {bell}
        {account}
      </div>
    </header>
  )
}

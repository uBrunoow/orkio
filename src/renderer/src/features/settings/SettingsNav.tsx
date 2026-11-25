import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PAGE_WIDTH } from '../../components/page-width'
import { TextField } from '@/components/form'
import { SETTINGS_TITLES, type SettingsSection } from '../../app/routes'
import { isTextField } from '../../app/keys'
import {
  AgentsIcon,
  BellIcon,
  BoardIcon,
  GaugeIcon,
  AppearanceIcon,
  LayoutIcon,
  InfoIcon,
  IntegrationsIcon,
  KeyboardIcon,
  LockIcon,
  PermissionIcon,
  PluginIcon,
  ProjectsIcon,
  RefreshIcon,
  SettingsIcon,
  TerminalIcon,
  ToolIcon,
  type SvgIcon
} from '../../components/icons'
import { visibleSettingsGroups } from './settings-sections'
import { ScopeNote } from './SettingsHeader'

const ICONS: Record<SettingsSection, SvgIcon> = {
  general: SettingsIcon,
  appearance: AppearanceIcon,
  layout: LayoutIcon,
  notifications: BellIcon,
  shortcuts: KeyboardIcon,
  terminal: TerminalIcon,
  integrations: IntegrationsIcon,
  projects: ProjectsIcon,
  providers: GaugeIcon,
  board: BoardIcon,
  agents: AgentsIcon,
  skills: PluginIcon,
  mcp: ToolIcon,
  secrets: LockIcon,
  diagnostics: PermissionIcon,
  updates: RefreshIcon,
  about: InfoIcon
}

/**
 * "/" foca a busca da coluna fora de campo de texto. Ouve no `document` (antes do `window`): a
 * tela que tem a própria busca (Integrações, Agentes) ouve no `window`, roda depois e fica com o
 * foco.
 */
function useNavSlashFocus(target: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return
      const input = target.current?.querySelector('input')
      if (!input) return
      e.preventDefault()
      input.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [target])
}

/**
 * Configurações: coluna interna (Básico · Conexões · Agentes e ferramentas · Projeto · App) com
 * busca, e a seção escolhida ao lado com a linha "Vale para". As seções do projeto só aparecem com
 * um projeto vinculado ao Notion.
 */

export function SettingsLayout({
  section,
  projectName,
  scope,
  scopePicker,
  onSection,
  children
}: {
  section: SettingsSection
  /** Projeto atual vinculado ao Notion; `null` esconde as seções do projeto. */
  projectName: string | null
  /** A quem a seção vale; `null` = a própria tela diz. */
  scope: string | null
  /** Seletor do projeto das telas por projeto (Quadro e automações, Agentes do projeto). */
  scopePicker?: React.ReactNode
  onSection(section: SettingsSection): void
  children: React.ReactNode
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLDivElement>(null)
  useNavSlashFocus(searchBox)
  const groups = visibleSettingsGroups(projectName, query)

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Configurações"
        className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-soft px-2.5 py-3.5"
      >
        <div ref={searchBox} className="px-0.5 pb-2.5">
          <TextField
            label="Buscar configuração"
            labelHidden
            type="search"
            size="sm"
            placeholder="Buscar configuração (/)"
            value={query}
            onChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
        </div>
        {groups.length === 0 && (
          <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
            Nenhuma configuração com “{query.trim()}”.
          </p>
        )}
        {groups.map((g, i) => (
          <div key={g.id} className={cn('flex flex-col gap-0.5', i > 0 && 'pt-3.5')}>
            <span id={`settings-nav-${g.id}`} className="truncate px-2 pt-1 pb-1 label-caps">
              {g.title}
            </span>
            <ul aria-labelledby={`settings-nav-${g.id}`} className="flex flex-col gap-0.5">
              {g.items.map((id) => {
                const selected = section === id
                const Icon = ICONS[id]
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => onSection(id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none',
                        selected
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4',
                          selected ? 'text-foreground' : 'text-subtle-foreground'
                        )}
                      />
                      <span className="truncate">{SETTINGS_TITLES[id]}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6 [scrollbar-gutter:stable_both-edges]">
        <div className={cn('flex w-full flex-col gap-[18px]', PAGE_WIDTH.form)}>
          {scope && <ScopeNote scope={scope} picker={scopePicker} className="-mb-2.5" />}
          {children}
        </div>
      </div>
    </div>
  )
}

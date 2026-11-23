import { cn } from '@/lib/utils'
import { SETTINGS_TITLES, type SettingsSection } from '../../app/routes'
import {
  AgentsIcon,
  BoardIcon,
  InfoIcon,
  IntegrationsIcon,
  ProjectsIcon,
  RefreshIcon,
  type SvgIcon
} from '../../components/icons'

const GROUPS: { title: string; project?: true; items: [SettingsSection, SvgIcon][] }[] = [
  {
    title: 'Geral',
    items: [
      ['integrations', IntegrationsIcon],
      ['projects', ProjectsIcon]
    ]
  },
  {
    title: 'Projeto',
    project: true,
    items: [
      ['board', BoardIcon],
      ['agents', AgentsIcon]
    ]
  },
  {
    title: 'App',
    items: [
      ['updates', RefreshIcon],
      ['about', InfoIcon]
    ]
  }
]

/**
 * Configurações: coluna interna (Geral · Projeto · App) e a seção escolhida ao lado. As seções do
 * projeto só aparecem com um projeto vinculado ao Notion.
 */
export function SettingsLayout({
  section,
  projectName,
  onSection,
  children
}: {
  section: SettingsSection
  /** Projeto atual vinculado ao Notion; `null` esconde as seções do projeto. */
  projectName: string | null
  onSection(section: SettingsSection): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Configurações"
        className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-soft px-2.5 py-3.5"
      >
        {GROUPS.filter((g) => !g.project || projectName).map((g, i) => {
          const title = g.project && projectName ? `Projeto · ${projectName}` : g.title
          return (
            <div key={g.title} className={cn('flex flex-col gap-0.5', i > 0 && 'pt-3.5')}>
              <span
                id={`settings-nav-${g.title}`}
                className="truncate px-2 pt-1 pb-1 text-[10.5px] tracking-[0.08em] text-subtle-foreground uppercase"
              >
                {title}
              </span>
              <ul aria-labelledby={`settings-nav-${g.title}`} className="flex flex-col gap-0.5">
                {g.items.map(([id, Icon]) => {
                  const selected = section === id
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => onSection(id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
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
          )
        })}
      </nav>
      {/* A seção rola sozinha; a coluna interna fica parada. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-8 py-6">
        {children}
      </div>
    </div>
  )
}

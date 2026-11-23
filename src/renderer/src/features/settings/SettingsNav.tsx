import { HStack } from '@astryxdesign/core/HStack'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { StackItem } from '@astryxdesign/core/Stack'
import { VStack } from '@astryxdesign/core/VStack'
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
    <HStack gap={6} vAlign="start" height="100%">
      <VStack>
        <SideNav aria-label="Configurações">
          {GROUPS.filter((g) => !g.project || projectName).map((g) => (
            <SideNavSection
              key={g.title}
              title={g.project && projectName ? `Projeto · ${projectName}` : g.title}
            >
              {g.items.map(([id, icon]) => (
                <SideNavItem
                  key={id}
                  label={SETTINGS_TITLES[id]}
                  icon={icon}
                  isSelected={section === id}
                  onClick={() => onSection(id)}
                />
              ))}
            </SideNavSection>
          ))}
        </SideNav>
      </VStack>
      <StackItem size="fill">{children}</StackItem>
    </HStack>
  )
}

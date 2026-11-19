import { useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { IntegrationsIcon, ProjectsIcon, type SvgIcon } from './components/icons'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { OrkioLogo } from './components/OrkioLogo/OrkioLogo'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { ProjectsPage } from './features/projects/ProjectsPage'

type Page = 'projects' | 'integrations'

const PAGES: { id: Page; label: string; icon: SvgIcon }[] = [
  { id: 'projects', label: 'Projetos', icon: ProjectsIcon },
  { id: 'integrations', label: 'Integrações', icon: IntegrationsIcon }
]

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('projects')

  return (
    <AppShell
      height="fill"
      contentPadding={6}
      // Sem gaveta mobile: as camadas deslizantes da Astryx injetam <style> (bloqueado pela CSP).
      mobileNav={false}
      sideNav={
        <SideNav
          aria-label="Navegação principal"
          header={<OrkioLogo variant="simple" withWordmark size={26} />}
        >
          <SideNavSection title="Orkio" isHeaderHidden>
            {PAGES.map((item) => (
              <SideNavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                isSelected={page === item.id}
                onClick={() => setPage(item.id)}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
    >
      {page === 'projects' ? (
        <ProjectsPage onOpenIntegrations={() => setPage('integrations')} />
      ) : (
        <IntegrationsPage />
      )}
    </AppShell>
  )
}

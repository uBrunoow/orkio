import { useEffect, useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import {
  AgentsIcon,
  BoardIcon,
  IntegrationsIcon,
  ProjectsIcon,
  type SvgIcon
} from './components/icons'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import type { BoardTaskRef } from '../../shared/ipc-contract'
import { OrkioLogo } from './components/OrkioLogo/OrkioLogo'
import { BoardPage } from './features/board/BoardPage'
import { AgentsPage } from './features/agents/AgentsPage'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { WelcomePage } from './features/welcome/WelcomePage'
import { ProjectsPage } from './features/projects/ProjectsPage'

type Page = 'welcome' | 'projects' | 'board' | 'agents' | 'integrations'

const PAGES: { id: Exclude<Page, 'welcome'>; label: string; icon: SvgIcon }[] = [
  { id: 'projects', label: 'Projetos', icon: ProjectsIcon },
  { id: 'board', label: 'Quadro', icon: BoardIcon },
  { id: 'agents', label: 'Agentes', icon: AgentsIcon },
  { id: 'integrations', label: 'Integrações', icon: IntegrationsIcon }
]

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('welcome')
  const [openTask, setOpenTask] = useState<BoardTaskRef | null>(null)

  // Clique numa notificação de automação: abre a tarefa no quadro.
  useEffect(
    () =>
      window.orkio.board.onOpenTask((ref) => {
        setOpenTask(ref)
        setPage('board')
      }),
    []
  )

  // Tela inicial em tela cheia, sem a navegação.
  if (page === 'welcome') {
    return (
      <WelcomePage
        onStart={() => setPage('projects')}
        onOpenIntegrations={() => setPage('integrations')}
      />
    )
  }

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
                onClick={() => {
                  setOpenTask(null)
                  setPage(item.id)
                }}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
    >
      {page === 'projects' ? (
        <ProjectsPage onOpenIntegrations={() => setPage('integrations')} />
      ) : page === 'board' ? (
        <BoardPage
          onOpenIntegrations={() => setPage('integrations')}
          onOpenProjects={() => setPage('projects')}
          openTask={openTask}
        />
      ) : page === 'agents' ? (
        <AgentsPage />
      ) : (
        <IntegrationsPage />
      )}
    </AppShell>
  )
}

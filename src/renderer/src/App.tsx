import { useEffect, useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Badge } from '@astryxdesign/core/Badge'
import { VStack } from '@astryxdesign/core/VStack'
import {
  AgentsIcon,
  BoardIcon,
  IntegrationsIcon,
  OverviewIcon,
  ProjectsIcon,
  SettingsIcon,
  type SvgIcon
} from './components/icons'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import type { BoardTaskRef } from '../../shared/ipc-contract'
import { OrkioLogo } from './components/OrkioLogo/OrkioLogo'
import { BoardPage } from './features/board/BoardPage'
import { AgentsPage } from './features/agents/AgentsPage'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { OverviewPage } from './features/overview/OverviewPage'
import { useWaitingCount } from './features/overview/useOverview'
import { WelcomePage } from './features/welcome/WelcomePage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { UpdateBanner } from './features/settings/UpdateBanner'

type Page = 'welcome' | 'overview' | 'board' | 'agents' | 'projects' | 'integrations' | 'settings'

/** Ordem do menu = atalhos Ctrl/Cmd+1, 2, 3… */
const PAGES: { id: Exclude<Page, 'welcome'>; label: string; icon: SvgIcon }[] = [
  { id: 'overview', label: 'Visão geral', icon: OverviewIcon },
  { id: 'board', label: 'Quadro', icon: BoardIcon },
  { id: 'agents', label: 'Agentes', icon: AgentsIcon },
  { id: 'projects', label: 'Projetos', icon: ProjectsIcon },
  { id: 'integrations', label: 'Integrações', icon: IntegrationsIcon },
  { id: 'settings', label: 'Configurações', icon: SettingsIcon }
]

const IS_MAC = navigator.userAgent.includes('Mac')

export function App(): React.JSX.Element | null {
  // `null` = ainda decidindo: quem já tem projeto abre na Visão geral; senão, "Vamos começar".
  const [page, setPage] = useState<Page | null>(null)
  const [openTask, setOpenTask] = useState<BoardTaskRef | null>(null)
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const waiting = useWaitingCount(page !== null && page !== 'welcome')

  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((r) => {
        if (active) setPage((p) => p ?? (r.projects.length > 0 ? 'overview' : 'welcome'))
      })
      .catch(() => {
        if (active) setPage((p) => p ?? 'welcome')
      })
    return () => {
      active = false
    }
  }, [])

  const go = (next: Exclude<Page, 'welcome'>): void => {
    setOpenTask(null)
    setOpenProjectId(null)
    setPage(next)
  }

  // Clique numa notificação de automação: abre a tarefa no quadro.
  useEffect(
    () =>
      window.orkio.board.onOpenTask((ref) => {
        setOpenTask(ref)
        setPage('board')
      }),
    []
  )

  // Atalhos: Ctrl/Cmd+1… vai para os itens do menu, na ordem.
  useEffect(() => {
    if (page === null || page === 'welcome') return
    const onKey = (e: KeyboardEvent): void => {
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!mod || e.altKey || e.shiftKey) return
      const target = PAGES[Number(e.key) - 1]
      if (!/^[1-9]$/.test(e.key) || !target) return
      e.preventDefault()
      setOpenTask(null)
      setOpenProjectId(null)
      setPage(target.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page])

  if (page === null) return null

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
            {PAGES.map((item, i) => (
              <SideNavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                isSelected={page === item.id}
                aria-keyshortcuts={`${IS_MAC ? 'Meta' : 'Control'}+${i + 1}`}
                {...(item.id === 'overview' && waiting > 0
                  ? {
                      endContent: (
                        <Badge
                          label={String(waiting)}
                          variant="orange"
                          aria-label={`${waiting} esperando você`}
                        />
                      )
                    }
                  : {})}
                onClick={() => go(item.id)}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
    >
      <VStack gap={4}>
        {/* Atualização pronta (6C) e "O que há de novo": no topo de qualquer página. */}
        <UpdateBanner {...(page === 'settings' ? {} : { onOpenSettings: () => go('settings') })} />
        {page === 'overview' ? (
          <OverviewPage
            onOpenTask={(ref) => {
              setOpenProjectId(null)
              setOpenTask(ref)
              setPage('board')
            }}
            onOpenProject={(projectId) => {
              setOpenTask(null)
              setOpenProjectId(projectId)
              setPage('board')
            }}
            onOpenProjects={() => go('projects')}
          />
        ) : page === 'projects' ? (
          <ProjectsPage onOpenIntegrations={() => setPage('integrations')} />
        ) : page === 'board' ? (
          <BoardPage
            onOpenIntegrations={() => setPage('integrations')}
            onOpenProjects={() => setPage('projects')}
            openTask={openTask}
            openProjectId={openProjectId}
          />
        ) : page === 'agents' ? (
          <AgentsPage />
        ) : page === 'settings' ? (
          <SettingsPage />
        ) : (
          <IntegrationsPage />
        )}
      </VStack>
    </AppShell>
  )
}

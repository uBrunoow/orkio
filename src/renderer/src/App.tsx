import { Fragment, useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Kbd } from '@astryxdesign/core/Kbd'
import { AppShell } from '@astryxdesign/core/AppShell'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import type { ProjectView } from '../../shared/ipc-contract'
import {
  BoardIcon,
  ClaudeLogo,
  FlowsIcon,
  IntegrationsIcon,
  OverviewIcon,
  ProjectsIcon,
  SearchIcon,
  StagesIcon,
  type SvgIcon
} from './components/icons'
import { OrkioLogo } from './components/OrkioLogo/OrkioLogo'
import {
  ROUTE_TITLES,
  initialRouter,
  isProjectRoute,
  routerReducer,
  type ProjectRouteName,
  type Route
} from './app/routes'
import { CommandMenu, type CommandData } from './app/CommandMenu'
import { SHORTCUTS, globalShortcut, isTextField } from './app/shortcuts'
import { BoardPage } from './features/board/BoardPage'
import { AutomationsPage, ContextPage, FlowsPage } from './features/board/ProjectPages'
import { TaskPage } from './features/board/TaskPage'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { OverviewPage } from './features/overview/OverviewPage'
import { useWaitingCount } from './features/overview/useOverview'
import { WelcomePage } from './features/welcome/WelcomePage'
import { ProjectsPage } from './features/projects/ProjectsPage'

/** Preferência de interface (não secreta): último projeto escolhido no menu. */
const CURRENT_PROJECT_KEY = 'orkio.currentProject'

const PROJECT_ITEMS: { name: ProjectRouteName; icon: SvgIcon }[] = [
  { name: 'board', icon: BoardIcon },
  { name: 'automations', icon: StagesIcon },
  { name: 'flows', icon: FlowsIcon },
  { name: 'context', icon: ClaudeLogo }
]

/** Projetos vinculados ao Notion (os que têm quadro). Relido a cada navegação: é local e barato. */
function useLinkedProjects(trigger: number): ProjectView[] | null {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((result) => {
        if (active) setProjects(result.projects.filter((p) => p.notionProject))
      })
      .catch(() => {
        if (active) setProjects([])
      })
    return () => {
      active = false
    }
  }, [trigger])
  return projects
}

/** `aria-keyshortcuts` do item do menu (mesmo atalho da paleta). */
function keyshortcut(route: Route['name']): string | undefined {
  const keys = SHORTCUTS.find((s) => s.route.name === route)?.keys
  return keys?.replace('mod', navigator.userAgent.includes('Mac') ? 'Meta' : 'Control')
}

export function App(): React.JSX.Element | null {
  const [router, dispatch] = useReducer(routerReducer, initialRouter({ name: 'welcome' }))
  const { route } = router
  const navigate = useCallback((next: Route) => dispatch({ type: 'navigate', route: next }), [])
  const projects = useLinkedProjects(router.key)
  // Quem já tem projeto abre na Visão geral (6D); sem projeto, "Vamos começar".
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((r) => {
        if (!active) return
        if (r.projects.length > 0) dispatch({ type: 'reset', route: { name: 'overview' } })
        setReady(true)
      })
      .catch(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])
  const waiting = useWaitingCount(ready && route.name !== 'welcome')
  const [chosenProject, setChosenProject] = useState<string | null>(() =>
    window.localStorage.getItem(CURRENT_PROJECT_KEY)
  )

  // Projeto atual: o da rota (ex.: notificação) → o escolhido no menu → o primeiro vinculado.
  const routeProjectId = isProjectRoute(route) ? route.projectId : undefined
  const project = useMemo(() => {
    if (!projects) return null
    return (
      projects.find((p) => p.id === routeProjectId) ??
      projects.find((p) => p.id === chosenProject) ??
      projects[0] ??
      null
    )
  }, [projects, routeProjectId, chosenProject])

  const chooseProject = useCallback((id: string) => {
    setChosenProject(id)
    window.localStorage.setItem(CURRENT_PROJECT_KEY, id)
  }, [])

  // Clique numa notificação de automação: abre a tarefa no quadro do projeto dela.
  useEffect(
    () =>
      window.orkio.board.onOpenTask((ref) => {
        chooseProject(ref.projectId)
        navigate({
          name: 'board',
          projectId: ref.projectId,
          taskId: ref.taskId,
          ...(ref.section ? { section: ref.section } : {})
        })
      }),
    [chooseProject, navigate]
  )

  // Atalhos globais e Command Palette (fora da tela inicial).
  const [paletteOpen, setPaletteOpen] = useState(false)
  const inShell = route.name !== 'welcome'
  useEffect(() => {
    if (!inShell) return
    const isMac = navigator.userAgent.includes('Mac')
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const action = globalShortcut(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          inTextField: isTextField(e.target)
        },
        isMac
      )
      if (!action) return
      e.preventDefault()
      if (action.type === 'palette') setPaletteOpen((open) => !open)
      else if (action.type === 'back') dispatch({ type: 'back' })
      else navigate(action.route)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inShell, navigate])

  const runCommand = (command: CommandData): void => {
    if (command.projectId) {
      chooseProject(command.projectId)
      navigate(isProjectRoute(route) ? { name: route.name } : { name: 'board' })
      return
    }
    if (!command.route) return
    if (isProjectRoute(command.route) && command.route.projectId) {
      chooseProject(command.route.projectId)
    }
    navigate(command.route)
  }

  if (!ready) return null

  // Tela inicial em tela cheia, sem a navegação.
  if (route.name === 'welcome') {
    return (
      <WelcomePage
        onStart={() => navigate({ name: 'projects' })}
        onOpenIntegrations={() => navigate({ name: 'integrations' })}
      />
    )
  }

  const toProjects = (): void => navigate({ name: 'projects' })
  const toIntegrations = (): void => navigate({ name: 'integrations' })
  const toBoard = (): void => navigate({ name: 'board' })

  let page: React.ReactNode
  switch (route.name) {
    case 'overview':
      page = (
        <OverviewPage
          onOpenTask={(ref) => {
            chooseProject(ref.projectId)
            navigate({
              name: 'board',
              projectId: ref.projectId,
              taskId: ref.taskId,
              ...(ref.section ? { section: ref.section } : {})
            })
          }}
          onOpenProject={(projectId) => {
            chooseProject(projectId)
            navigate({ name: 'board', projectId })
          }}
          onOpenProjects={toProjects}
        />
      )
      break
    case 'projects':
      page = (
        <ProjectsPage
          onOpenIntegrations={toIntegrations}
          onOpenBoard={(projectId) => {
            chooseProject(projectId)
            navigate({ name: 'board', projectId })
          }}
        />
      )
      break
    case 'integrations':
      page = <IntegrationsPage />
      break
    case 'board':
      page = (
        <BoardPage
          project={projects === null ? null : project}
          openTaskId={route.taskId ?? null}
          focusSection={route.section ?? null}
          onOpenIntegrations={toIntegrations}
          onOpenProjects={toProjects}
          onExpandTask={(taskId) =>
            project && navigate({ name: 'task', projectId: project.id, taskId })
          }
        />
      )
      break
    case 'task':
      page = (
        <TaskPage
          project={projects === null ? null : project}
          taskId={route.taskId}
          onBackToBoard={(taskId) =>
            navigate({ name: 'board', projectId: route.projectId, ...(taskId ? { taskId } : {}) })
          }
        />
      )
      break
    case 'automations':
      page = (
        <AutomationsPage
          project={project}
          onOpenBoard={toBoard}
          onOpenFlows={() => navigate({ name: 'flows' })}
          onOpenProjects={toProjects}
        />
      )
      break
    case 'flows':
      page = (
        <FlowsPage
          project={project}
          tab={route.tab ?? 'flows'}
          onTabChange={(tab) => navigate({ name: 'flows', tab })}
          onOpenBoard={toBoard}
          onOpenProjects={toProjects}
        />
      )
      break
    case 'context':
      page = <ContextPage project={project} onOpenProjects={toProjects} />
      break
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
            <SideNavItem
              label={ROUTE_TITLES.overview}
              icon={OverviewIcon}
              isSelected={route.name === 'overview'}
              aria-keyshortcuts={keyshortcut('overview')}
              {...(waiting > 0
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
              onClick={() => navigate({ name: 'overview' })}
            />
          </SideNavSection>
          <SideNavSection
            title={project ? project.name : 'Projeto'}
            subtitle="Projeto atual"
            {...(projects && projects.length > 1
              ? {
                  endContent: (
                    <DropdownMenu
                      button={{ label: 'Trocar projeto', size: 'sm', variant: 'ghost' }}
                      hasChevron={false}
                      items={projects.map((p) => ({
                        label: p.name,
                        onClick: () => {
                          chooseProject(p.id)
                          navigate(isProjectRoute(route) ? { name: route.name } : { name: 'board' })
                        }
                      }))}
                    />
                  )
                }
              : {})}
          >
            {PROJECT_ITEMS.map((item) => (
              <SideNavItem
                key={item.name}
                label={ROUTE_TITLES[item.name]}
                icon={item.icon}
                isSelected={
                  route.name === item.name || (item.name === 'board' && route.name === 'task')
                }
                aria-keyshortcuts={keyshortcut(item.name)}
                onClick={() => navigate({ name: item.name })}
              />
            ))}
          </SideNavSection>
          <SideNavSection title="Orkio" isHeaderHidden>
            <SideNavItem
              label="Buscar"
              icon={SearchIcon}
              endContent={<Kbd keys="mod+k" />}
              onClick={() => setPaletteOpen(true)}
            />
            <SideNavItem
              label={ROUTE_TITLES.projects}
              icon={ProjectsIcon}
              isSelected={route.name === 'projects'}
              aria-keyshortcuts={keyshortcut('projects')}
              onClick={toProjects}
            />
            <SideNavItem
              label={ROUTE_TITLES.integrations}
              icon={IntegrationsIcon}
              isSelected={route.name === 'integrations'}
              aria-keyshortcuts={keyshortcut('integrations')}
              onClick={toIntegrations}
            />
          </SideNavSection>
        </SideNav>
      }
    >
      {/* Chave nova a cada navegação: clicar no item atual sai de qualquer subtela. */}
      <Fragment key={router.key}>{page}</Fragment>
      <CommandMenu
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects ?? []}
        currentProjectId={project?.id ?? null}
        onRun={runCommand}
      />
    </AppShell>
  )
}

import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Button } from '@astryxdesign/core/Button'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardTaskRef, ProjectView } from '../../shared/ipc-contract'
import { AgentsIcon, BoardIcon, SearchIcon, SettingsIcon, TONE_DOT_ICONS } from './components/icons'
import { OrkioLogo } from './components/OrkioLogo/OrkioLogo'
import {
  ROUTE_TITLES,
  SETTINGS_TITLES,
  initialRouter,
  routeForTaskRef,
  routerReducer,
  type Route
} from './app/routes'
import { CommandMenu, type CommandData } from './app/CommandMenu'
import { SHORTCUTS, globalShortcut, isTextField } from './app/shortcuts'
import { initialRoute } from './app/initial-route'
import type { SidebarTask } from './app/task-groups'
import { useSidebarData } from './app/useSidebarData'
import { WaitingBell } from './app/WaitingBell'
import { BoardPage } from './features/board/BoardPage'
import { AgentsPage } from './features/agents/AgentsPage'
import { AutomationsPage, FlowsPage } from './features/board/ProjectPages'
import { TaskScreen } from './features/task/TaskScreen'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { WelcomePage } from './features/welcome/WelcomePage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { UpdateBanner } from './features/settings/UpdateBanner'

/** Preferência de interface (não secreta): último projeto escolhido no menu. */
const CURRENT_PROJECT_KEY = 'orkio.currentProject'

/** Projetos (todos; o quadro só existe nos vinculados ao Notion). Relido a cada navegação. */
function useProjects(trigger: number): ProjectView[] | null {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((result) => {
        if (active) setProjects(result.projects)
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

function routeProjectId(route: Route): string | undefined {
  return 'projectId' in route ? route.projectId : undefined
}

export function App(): React.JSX.Element | null {
  const [router, dispatch] = useReducer(routerReducer, initialRouter({ name: 'board' }))
  const { route } = router
  const navigate = useCallback((next: Route) => dispatch({ type: 'navigate', route: next }), [])
  const projects = useProjects(router.key)
  const [chosenProject, setChosenProject] = useState<string | null>(() =>
    window.localStorage.getItem(CURRENT_PROJECT_KEY)
  )

  // Projeto atual: o da rota (ex.: notificação) → o escolhido no menu → o primeiro.
  const fromRoute = routeProjectId(route)
  const project = useMemo(() => {
    if (!projects) return null
    return (
      projects.find((p) => p.id === fromRoute) ??
      projects.find((p) => p.id === chosenProject) ??
      projects[0] ??
      null
    )
  }, [projects, fromRoute, chosenProject])
  const linkedProject = project?.notionProject ? project : null

  const chooseProject = useCallback((id: string) => {
    setChosenProject(id)
    window.localStorage.setItem(CURRENT_PROJECT_KEY, id)
  }, [])

  const sidebar = useSidebarData(linkedProject?.id ?? null)

  // Primeira tela: sem projeto, Primeiros passos; com algo esperando, essa tarefa; senão o Quadro.
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current || projects === null) return
    if (projects.length === 0) {
      decided.current = true
      dispatch({ type: 'reset', route: { name: 'setup' } })
      return
    }
    // Espera a Visão geral responder para saber se há algo esperando você (só dados locais).
    if (linkedProject && sidebar.snapshot === null) return
    decided.current = true
    dispatch({
      type: 'reset',
      route: initialRoute({
        projectCount: projects.length,
        currentProjectId: linkedProject?.id ?? null,
        groups: sidebar.groups
      })
    })
  }, [projects, linkedProject, sidebar.snapshot, sidebar.groups])

  const openTask = useCallback(
    (ref: BoardTaskRef) => {
      chooseProject(ref.projectId)
      navigate(routeForTaskRef(ref))
    },
    [chooseProject, navigate]
  )

  // Clique numa notificação: abre a tarefa (troca o projeto quando é de outro).
  useEffect(() => window.orkio.board.onOpenTask(openTask), [openTask])

  // Atalhos globais e Command Palette (fora dos Primeiros passos).
  const [paletteOpen, setPaletteOpen] = useState(false)
  const inShell = route.name !== 'setup'
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
      navigate(route.name === 'task' || route.name === 'setup' ? { name: 'board' } : route)
      return
    }
    if (!command.route) return
    const target = routeProjectId(command.route)
    if (target) chooseProject(target)
    navigate(command.route)
  }

  // A primeira tela é decidida por um `reset` (chave nova); até lá, nada na tela.
  if (router.key === 0) return null

  const toSettings = (section: 'integrations' | 'projects'): void =>
    navigate({ name: 'settings', section })
  const toBoard = (): void => navigate({ name: 'board' })

  // Primeiros passos em tela cheia, sem a navegação.
  if (route.name === 'setup') {
    return (
      <WelcomePage
        onStart={() => toSettings('projects')}
        onOpenIntegrations={() => toSettings('integrations')}
      />
    )
  }

  let page: React.ReactNode
  let title: string = ROUTE_TITLES[route.name]
  switch (route.name) {
    case 'board':
      page = (
        <BoardPage
          project={projects === null ? null : linkedProject}
          onOpenIntegrations={() => toSettings('integrations')}
          onOpenProjects={() => toSettings('projects')}
          onOpenTask={(taskId) =>
            linkedProject && navigate({ name: 'task', projectId: linkedProject.id, taskId })
          }
        />
      )
      break
    case 'task':
      page = (
        <TaskScreen
          project={projects === null ? null : linkedProject}
          taskId={route.taskId}
          section={route.section ?? null}
          onBackToBoard={() => navigate({ name: 'board', projectId: route.projectId })}
        />
      )
      break
    case 'agents':
      page = <AgentsPage />
      break
    case 'settings': {
      const section = route.section ?? 'integrations'
      title = `${ROUTE_TITLES.settings} › ${SETTINGS_TITLES[section]}`
      switch (section) {
        case 'integrations':
          page = <IntegrationsPage />
          break
        case 'projects':
          page = (
            <ProjectsPage
              onOpenIntegrations={() => toSettings('integrations')}
              onOpenBoard={(projectId) => {
                chooseProject(projectId)
                navigate({ name: 'board', projectId })
              }}
            />
          )
          break
        case 'board':
          page =
            route.tab === 'flows' ? (
              <FlowsPage
                project={linkedProject}
                tab="flows"
                onTabChange={() => undefined}
                onOpenBoard={toBoard}
                onOpenProjects={() => toSettings('projects')}
              />
            ) : (
              <AutomationsPage
                project={linkedProject}
                onOpenBoard={toBoard}
                onOpenFlows={() => navigate({ name: 'settings', section: 'board', tab: 'flows' })}
                onOpenProjects={() => toSettings('projects')}
              />
            )
          break
        case 'agents':
          page = <AgentsPage />
          break
        default:
          page = <SettingsPage />
      }
      break
    }
  }

  const projectPicker =
    projects && projects.length > 1 ? (
      <DropdownMenu
        button={{
          label: project ? project.name : 'Projetos',
          size: 'sm',
          variant: 'secondary',
          'aria-label': `Projeto atual: ${project ? project.name : 'nenhum'}. Trocar projeto`
        }}
        items={projects.map((p) => ({
          label: p.name,
          onClick: () => {
            chooseProject(p.id)
            navigate(
              route.name === 'board' || route.name === 'settings'
                ? { ...route, projectId: p.id }
                : route.name === 'agents'
                  ? route
                  : { name: 'board' }
            )
          }
        }))}
      />
    ) : (
      <Text type="supporting" data-testid="current-project">
        {project ? project.name : 'Nenhum projeto'}
      </Text>
    )

  const taskItems = (
    title: string,
    items: SidebarTask[],
    extra?: React.ReactNode
  ): React.ReactNode =>
    items.length === 0 && !extra ? null : (
      <SideNavSection title={title} endContent={<Text type="supporting">{items.length}</Text>}>
        {items.map((t) => (
          <SideNavItem
            key={t.taskId}
            size="sm"
            icon={TONE_DOT_ICONS[t.tone]}
            label={`${t.displayId ? `${t.displayId} · ` : ''}${t.title}`}
            isSelected={route.name === 'task' && route.taskId === t.taskId}
            onClick={() =>
              linkedProject &&
              openTask({
                projectId: linkedProject.id,
                taskId: t.taskId,
                ...(t.section ? { section: t.section } : {})
              })
            }
          />
        ))}
        {extra}
      </SideNavSection>
    )

  const groups = sidebar.groups
  return (
    <AppShell
      height="fill"
      contentPadding={0}
      // Sem gaveta mobile: as camadas deslizantes da Astryx injetam <style> (bloqueado pela CSP).
      mobileNav={false}
      sideNav={
        <SideNav
          aria-label="Navegação principal"
          header={<OrkioLogo variant="simple" withWordmark size={18} />}
          topContent={
            <VStack gap={2}>
              {projectPicker}
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon icon={SearchIcon} />}
                label="Buscar tarefa"
                aria-keyshortcuts={navigator.userAgent.includes('Mac') ? 'Meta+K' : 'Control+K'}
                onClick={() => setPaletteOpen(true)}
              />
            </VStack>
          }
          footer={
            <SideNavSection title="Telas" isHeaderHidden>
              <SideNavItem
                label={ROUTE_TITLES.board}
                icon={BoardIcon}
                isSelected={route.name === 'board' || route.name === 'task'}
                aria-keyshortcuts={keyshortcut('board')}
                onClick={toBoard}
              />
              <SideNavItem
                label={ROUTE_TITLES.agents}
                icon={AgentsIcon}
                isSelected={route.name === 'agents'}
                aria-keyshortcuts={keyshortcut('agents')}
                onClick={() => navigate({ name: 'agents' })}
              />
              <SideNavItem
                label={ROUTE_TITLES.settings}
                icon={SettingsIcon}
                isSelected={route.name === 'settings'}
                aria-keyshortcuts={keyshortcut('settings')}
                onClick={() => navigate({ name: 'settings' })}
              />
            </SideNavSection>
          }
        >
          {groups && (
            <>
              {taskItems('Esperando você', groups.waiting)}
              {taskItems('Rodando', groups.running)}
              {taskItems(
                'A fazer',
                groups.todo,
                groups.todoTotal > groups.todo.length ? (
                  <SideNavItem size="sm" label="Ver todas" onClick={toBoard} />
                ) : undefined
              )}
            </>
          )}
        </SideNav>
      }
    >
      <VStack height="100%">
        <HStack gap={2} vAlign="center" padding={3} data-testid="top-bar">
          <StackItem size="fill">
            <Text type="supporting" color="secondary">
              {project ? `${project.name} › ` : ''}
              <Text type="supporting">{title}</Text>
            </Text>
          </StackItem>
          <WaitingBell snapshot={sidebar.snapshot} onOpen={openTask} />
        </HStack>
        <StackItem size="fill">
          {/* Chave nova a cada navegação: clicar no item atual sai de qualquer subtela. */}
          <VStack
            gap={4}
            padding={6}
            {...(route.name === 'board' || route.name === 'task'
              ? { height: '100%' as const }
              : {})}
          >
            {/* Atualização pronta (6C) e "O que há de novo": no topo de qualquer página. */}
            <UpdateBanner
              {...(route.name === 'settings'
                ? {}
                : { onOpenSettings: () => navigate({ name: 'settings', section: 'updates' }) })}
            />
            <StackItem size="fill">
              <Fragment key={router.key}>{page}</Fragment>
            </StackItem>
          </VStack>
        </StackItem>
      </VStack>
      <CommandMenu
        isOpen={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={(projects ?? []).filter((p) => p.notionProject)}
        currentProjectId={project?.id ?? null}
        onRun={runCommand}
      />
    </AppShell>
  )
}

import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { BoardTaskRef, ProjectView } from '../../shared/ipc-contract'
import {
  ROUTE_TITLES,
  SETTINGS_TITLES,
  initialRouter,
  routeForTaskRef,
  routerReducer,
  type Route
} from './app/routes'
import { CommandMenu, type CommandData } from './app/CommandMenu'
import { globalShortcut, isTextField } from './app/shortcuts'
import { initialRoute } from './app/initial-route'
import { useSidebarData } from './app/useSidebarData'
import { useSetupPending } from './app/useSetupPending'
import { WaitingBell } from './app/WaitingBell'
import { Sidebar } from './app/Sidebar'
import { AccountMenu, useAccount } from './app/AccountMenu'
import { ScreenFrame } from './app/ScreenBar'
import { BoardPage } from './features/board/BoardPage'
import { AgentsPage } from './features/agents/AgentsPage'
import { ProjectAgentsSettings } from './features/agents/ProjectAgentsSettings'
import { BoardSettingsPage } from './features/board/ProjectPages'
import { TaskScreen } from './features/task/TaskScreen'
import { IntegrationsPage } from './features/integrations/IntegrationsPage'
import { SetupPage } from './features/setup/SetupPage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { AboutSection, PowerSection, UpdatesSection } from './features/settings/SettingsPage'
import { SettingsLayout } from './features/settings/SettingsNav'
import { PageHeader } from './components/PageHeader'
import { PAGE_WIDTH } from './components/page-width'
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

  // Relê o quadro a cada navegação (ex.: quadro criado nos Primeiros passos).
  const sidebar = useSidebarData(linkedProject?.id ?? null, router.key)
  const setupMissing = useSetupPending(project, sidebar.board)
  const account = useAccount(router.key)
  // "Sair": o Orkio não tem login próprio; sair = desconectar GitHub e Notion deste computador.
  const signOut = async (): Promise<void> => {
    await Promise.all([
      window.orkio.github.disconnect().catch(() => undefined),
      window.orkio.notion.disconnect().catch(() => undefined)
    ])
    navigate({ name: 'setup', ...(project ? { projectId: project.id } : {}) })
  }

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
  // Paleta: `all` (Ctrl/Cmd+K: telas e tarefas) ou `tasks` ("Buscar tarefa": só tarefas, no Notion).
  const [palette, setPalette] = useState<'all' | 'tasks' | null>(null)
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
      if (action.type === 'palette') setPalette((open) => (open ? null : 'all'))
      else if (action.type === 'back') dispatch({ type: 'back' })
      else navigate(action.route)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inShell, navigate])

  const runCommand = (command: CommandData): void => {
    if (command.url) {
      // Tarefa de fora do quadro (outra pessoa ou projeto sem vínculo): abre no Notion.
      void window.orkio.openExternal(command.url)
      return
    }
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
      <SetupPage
        projectId={route.projectId ?? null}
        onExit={() => navigate({ name: 'board' })}
        onOpenTask={openTask}
        onOpenIntegrations={() => navigate({ name: 'settings', section: 'integrations' })}
      />
    )
  }

  let page: React.ReactNode
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
      page = (
        <AgentsPage
          projectId={linkedProject?.id ?? null}
          onOpenOrchestrator={() => navigate({ name: 'settings', section: 'agents' })}
        />
      )
      break
    case 'settings': {
      const section = route.section ?? 'integrations'
      switch (section) {
        case 'integrations':
          page = <IntegrationsPage projectId={project?.id ?? null} />
          break
        case 'projects':
          page = (
            <ProjectsPage
              onOpenIntegrations={() => toSettings('integrations')}
              onOpenBoard={(projectId) => {
                chooseProject(projectId)
                navigate({ name: 'board', projectId })
              }}
              onContinueSetup={(projectId) => {
                chooseProject(projectId)
                navigate({ name: 'setup', projectId })
              }}
            />
          )
          break
        case 'board':
          page = (
            <BoardSettingsPage
              project={linkedProject}
              tab={route.tab ?? 'columns'}
              onTabChange={(tab) => dispatch({ type: 'replace', route: { ...route, tab } })}
              onOpenBoard={toBoard}
              onOpenProjects={() => toSettings('projects')}
            />
          )
          break
        case 'agents':
          page = linkedProject ? (
            <ProjectAgentsSettings projectId={linkedProject.id} />
          ) : (
            <AgentsPage />
          )
          break
        case 'updates':
          page = (
            <div className={`flex flex-col gap-6 ${PAGE_WIDTH.form}`}>
              <PageHeader title={SETTINGS_TITLES.updates} />
              <UpdatesSection />
              <PowerSection />
            </div>
          )
          break
        case 'about':
          page = (
            <div className={`flex flex-col gap-6 ${PAGE_WIDTH.form}`}>
              <PageHeader title={SETTINGS_TITLES.about} />
              <AboutSection />
            </div>
          )
          break
      }
      page = (
        <SettingsLayout
          section={section}
          projectName={linkedProject?.name ?? null}
          onSection={(next) => navigate({ name: 'settings', section: next })}
        >
          {page}
        </SettingsLayout>
      )
      break
    }
  }

  const crumbs =
    route.name === 'settings'
      ? [
          { label: ROUTE_TITLES.settings, onClick: () => navigate({ name: 'settings' }) },
          ...(route.section === 'board' || route.section === 'agents'
            ? [
                {
                  label: linkedProject?.name ?? 'Projeto',
                  onClick: linkedProject ? () => toBoard() : undefined
                }
              ]
            : []),
          SETTINGS_TITLES[route.section ?? 'integrations']
        ]
      : null
  // Quadro e tarefa ocupam a altura toda (rolagem própria); o resto rola com margem.
  const fullHeight = route.name === 'board' || route.name === 'task'
  const keyed = <Fragment key={router.key}>{page}</Fragment>
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Atualização pronta (6C) e "O que há de novo": acima de tudo. */}
      <UpdateBanner
        {...(route.name === 'settings'
          ? {}
          : { onOpenSettings: () => navigate({ name: 'settings', section: 'updates' }) })}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          route={route}
          project={project}
          projects={projects}
          groups={sidebar.groups}
          setupMissing={setupMissing}
          onChooseProject={(id) => {
            chooseProject(id)
            navigate(
              route.name === 'board' || route.name === 'settings'
                ? { ...route, projectId: id }
                : route.name === 'agents'
                  ? route
                  : { name: 'board' }
            )
          }}
          onManageProjects={() => toSettings('projects')}
          onSearch={() => setPalette('tasks')}
          onOpenTask={(t) =>
            linkedProject &&
            openTask({
              projectId: linkedProject.id,
              taskId: t.taskId,
              ...(t.section ? { section: t.section } : {})
            })
          }
          onNavigate={navigate}
          onContinueSetup={() => project && navigate({ name: 'setup', projectId: project.id })}
          account={
            <AccountMenu
              account={account}
              variant="row"
              onOpenIntegrations={() => toSettings('integrations')}
              onOpenSettings={() => navigate({ name: 'settings' })}
              onSignOut={signOut}
            />
          }
        />
        <main className="min-h-0 min-w-0 flex-1">
          <ScreenFrame
            crumbs={crumbs}
            bell={
              <div className="flex items-center gap-2">
                <WaitingBell snapshot={sidebar.snapshot} onOpen={openTask} />
                <AccountMenu
                  account={account}
                  variant="avatar"
                  onOpenIntegrations={() => toSettings('integrations')}
                  onOpenSettings={() => navigate({ name: 'settings' })}
                  onSignOut={signOut}
                />
              </div>
            }
          >
            {/* Chave nova a cada navegação: clicar no item atual sai de qualquer subtela. */}
            {fullHeight || route.name === 'settings' ? (
              <div className="h-full min-h-0">{keyed}</div>
            ) : (
              <div className="h-full min-h-0 overflow-y-auto px-6 py-5">{keyed}</div>
            )}
          </ScreenFrame>
        </main>
      </div>
      <CommandMenu
        isOpen={palette !== null}
        onOpenChange={(open) => setPalette(open ? (palette ?? 'all') : null)}
        mode={palette ?? 'all'}
        projects={(projects ?? []).filter((p) => p.notionProject)}
        currentProjectId={project?.id ?? null}
        onRun={runCommand}
      />
    </div>
  )
}

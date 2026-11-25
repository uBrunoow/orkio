import { BoardPage } from '../features/board/BoardPage'
import { AgentsPage } from '../features/agents/AgentsPage'
import { ProjectAgentsSettings } from '../features/agents/ProjectAgentsSettings'
import { BoardSettingsPage } from '../features/board/ProjectPages'
import { TaskScreen } from '../features/task/TaskScreen'
import { IntegrationsPage } from '../features/integrations/IntegrationsPage'
import { SetupPage } from '../features/setup/SetupPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import {
  AboutSection,
  PowerSection,
  UpdatesSection,
  UsageMeterSection
} from '../features/settings/SettingsPage'
import { SettingsLayout } from '../features/settings/SettingsNav'
import { PageHeader } from '../components/PageHeader'
import { PAGE_WIDTH } from '../components/page-width'
import type { BoardTaskRef, OverviewSnapshot } from '../../../shared/overview'
import type { ProjectView } from '../../../shared/projects'
import { HomePage } from './HomePage'
import { ROUTE_TITLES, SETTINGS_TITLES, type Route, type RouteName } from './routes'
import type { Crumb } from './ScreenBar'

/** O que as telas recebem do app (a casca). */
export interface PageContext {
  projects: ProjectView[] | null
  /** Projeto atual (pode não estar vinculado ao Notion). */
  project: ProjectView | null
  /** Projeto atual se vinculado ao Notion (as telas do projeto precisam dele). */
  linkedProject: ProjectView | null
  snapshot: OverviewSnapshot | null
  isMac: boolean
  navigate(route: Route): void
  /** Troca a rota da aba sem remontar a tela (abas internas). */
  replace(route: Route): void
  chooseProject(id: string): void
  openTask(ref: BoardTaskRef): void
  palette(mode: 'all' | 'tasks'): void
}

export interface PageView {
  node: React.ReactNode
  /** Caminho da barra da tela (`null` = a tela põe o próprio título). */
  crumbs: readonly Crumb[] | null
  /** Ocupa a altura toda (rolagem própria); senão, a casca rola com respiro. */
  fullHeight: boolean
}

type Renderer<K extends RouteName> = (
  route: Extract<Route, { name: K }>,
  ctx: PageContext
) => PageView

function settingsPage(
  route: Extract<Route, { name: 'settings' }>,
  ctx: PageContext
): React.ReactNode {
  const { linkedProject, project, navigate } = ctx
  const toSettings = (section: 'integrations' | 'projects'): void =>
    navigate({ name: 'settings', section })
  switch (route.section ?? 'integrations') {
    case 'integrations':
      return <IntegrationsPage projectId={project?.id ?? null} />
    case 'projects':
      return (
        <ProjectsPage
          onOpenIntegrations={() => toSettings('integrations')}
          onOpenBoard={(projectId) => {
            ctx.chooseProject(projectId)
            navigate({ name: 'board', projectId })
          }}
          onContinueSetup={(projectId) => {
            ctx.chooseProject(projectId)
            navigate({ name: 'setup', projectId })
          }}
        />
      )
    case 'board':
      return (
        <BoardSettingsPage
          project={linkedProject}
          tab={route.tab ?? 'columns'}
          onTabChange={(tab) => ctx.replace({ ...route, tab })}
          onOpenBoard={() => navigate({ name: 'board' })}
          onOpenProjects={() => toSettings('projects')}
        />
      )
    case 'agents':
      return linkedProject ? <ProjectAgentsSettings projectId={linkedProject.id} /> : <AgentsPage />
    case 'updates':
      return (
        <div className={`flex flex-col gap-6 ${PAGE_WIDTH.form}`}>
          <PageHeader title={SETTINGS_TITLES.updates} />
          <UpdatesSection />
          <PowerSection />
          <UsageMeterSection />
        </div>
      )
    case 'about':
      return (
        <div className={`flex flex-col gap-6 ${PAGE_WIDTH.form}`}>
          <PageHeader title={SETTINGS_TITLES.about} />
          <AboutSection />
        </div>
      )
  }
}

/**
 * O desenho de cada tela do registro (`screens.ts`). O tipo exige uma entrada por rota: tela nova
 * que esquecer daqui não compila.
 */
export const SCREEN_PAGES: { [K in RouteName]: Renderer<K> } = {
  board: (_route, ctx) => ({
    node: (
      <BoardPage
        project={ctx.projects === null ? null : ctx.linkedProject}
        onOpenIntegrations={() => ctx.navigate({ name: 'settings', section: 'integrations' })}
        onOpenProjects={() => ctx.navigate({ name: 'settings', section: 'projects' })}
        onOpenTask={(taskId) =>
          ctx.linkedProject &&
          ctx.navigate({ name: 'task', projectId: ctx.linkedProject.id, taskId })
        }
      />
    ),
    crumbs: null,
    fullHeight: true
  }),
  task: (route, ctx) => ({
    node: (
      <TaskScreen
        project={ctx.projects === null ? null : ctx.linkedProject}
        taskId={route.taskId}
        section={route.section ?? null}
        onBackToBoard={() => ctx.navigate({ name: 'board', projectId: route.projectId })}
      />
    ),
    crumbs: null,
    fullHeight: true
  }),
  agents: (_route, ctx) => ({
    node: (
      <AgentsPage
        projectId={ctx.linkedProject?.id ?? null}
        onOpenOrchestrator={() => ctx.navigate({ name: 'settings', section: 'agents' })}
      />
    ),
    crumbs: null,
    fullHeight: false
  }),
  settings: (route, ctx) => {
    const section = route.section ?? 'integrations'
    const { linkedProject, navigate } = ctx
    return {
      node: (
        <SettingsLayout
          section={section}
          projectName={linkedProject?.name ?? null}
          onSection={(next) => navigate({ name: 'settings', section: next })}
        >
          {settingsPage(route, ctx)}
        </SettingsLayout>
      ),
      crumbs: [
        { label: ROUTE_TITLES.settings, onClick: () => navigate({ name: 'settings' }) },
        ...(section === 'board' || section === 'agents'
          ? [
              {
                label: linkedProject?.name ?? 'Projeto',
                onClick: linkedProject ? () => navigate({ name: 'board' }) : undefined
              }
            ]
          : []),
        SETTINGS_TITLES[section]
      ],
      fullHeight: true
    }
  },
  home: (_route, ctx) => ({
    node: (
      <HomePage
        snapshot={ctx.snapshot}
        hasProject={ctx.linkedProject !== null}
        isMac={ctx.isMac}
        onNavigate={ctx.navigate}
        onOpenTask={ctx.openTask}
        onPalette={ctx.palette}
      />
    ),
    crumbs: [ROUTE_TITLES.home],
    fullHeight: false
  }),
  setup: (route, ctx) => ({
    node: (
      <SetupPage
        projectId={route.projectId ?? null}
        onExit={() => ctx.navigate({ name: 'board' })}
        onOpenTask={ctx.openTask}
        onOpenIntegrations={() => ctx.navigate({ name: 'settings', section: 'integrations' })}
      />
    ),
    crumbs: null,
    fullHeight: true
  })
}

export function renderScreen(route: Route, ctx: PageContext): PageView {
  return (SCREEN_PAGES[route.name] as Renderer<typeof route.name>)(route as never, ctx)
}

import { BoardPage } from '../features/board/BoardPage'
import { AgentsPage } from '../features/agents/AgentsPage'
import { ProjectAgentsSettings } from '../features/agents/ProjectAgentsSettings'
import { BoardSettingsPage } from '../features/board/ProjectPages'
import { TaskScreen } from '../features/task/TaskScreen'
import { TerminalPage } from '../features/terminal/TerminalPage'
import { IntegrationsPage } from '../features/integrations/IntegrationsPage'
import { SetupPage } from '../features/setup/SetupPage'
import { ProjectsPage } from '../features/projects/ProjectsPage'
import { AboutSection, PowerSection, UpdatesSection } from '../features/settings/SettingsPage'
import { Select } from '@/components/ui/select'
import { SettingsLayout } from '../features/settings/SettingsNav'
import { settingsScope } from '../features/settings/settings-sections'
import { GeneralSection } from '../features/settings/GeneralSection'
import { TerminalsPage } from '../features/terminal/TerminalsPage'
import { AppearanceSection } from '../features/settings/AppearanceSection'
import { LayoutSection } from '../features/settings/LayoutSection'
import { NotificationsSection } from '../features/settings/NotificationsSection'
import { ShortcutsSection } from '../features/settings/ShortcutsSection'
import { TerminalSection } from '../features/settings/TerminalSection'
import { ProvidersSection } from '../features/settings/ProvidersSection'
import { DiagnosticsSection } from '../features/settings/DiagnosticsSection'
import { SkillsPage } from '../features/skills/SkillsPage'
import { McpPage } from '../features/mcp/McpPage'
import { SecretsPage } from '../features/secrets/SecretsPage'
import { PageHeader } from '../components/PageHeader'
import { PAGE_WIDTH } from '../components/page-width'
import type { BoardTaskRef, OverviewSnapshot } from '../../../shared/overview'
import type { ProjectView } from '../../../shared/projects'
import { HomePage } from './HomePage'
import {
  ROUTE_TITLES,
  SETTINGS_TITLES,
  type Route,
  type RouteName,
  type SettingsSection
} from './routes'
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
  /**
   * Largura do container centralizado (`PAGE_WIDTH`). Sem valor: `list`. `full` = a janela toda
   * (Quadro e terminal); Configurações têm o próprio container por seção.
   */
  width?: 'list' | 'wide' | 'full'
}

type Renderer<K extends RouteName> = (
  route: Extract<Route, { name: K }>,
  ctx: PageContext
) => PageView

/**
 * Projeto das telas por projeto (Quadro e automações, Agentes do projeto): o da rota (escolhido no
 * "Vale para") ou o atual. Escolher aqui não troca o projeto atual do app.
 */
function settingsProject(
  route: Extract<Route, { name: 'settings' }>,
  ctx: PageContext
): ProjectView | null {
  const linked = (ctx.projects ?? []).filter((p) => p.notionProject && !p.archived)
  return linked.find((p) => p.id === route.projectId) ?? ctx.linkedProject
}

/** "Vale para: [projeto ▾]": troca o projeto só desta tela. */
function SettingsProjectPicker({
  route,
  ctx
}: {
  route: Extract<Route, { name: 'settings' }>
  ctx: PageContext
}): React.JSX.Element | null {
  const linked = (ctx.projects ?? []).filter((p) => p.notionProject && !p.archived)
  const current = settingsProject(route, ctx)
  if (linked.length === 0 || !current) return null
  return (
    <Select
      aria-label="Projeto desta tela"
      size="sm"
      value={current.id}
      options={linked.map((p) => ({ value: p.id, label: p.name }))}
      onChange={(projectId) => ctx.replace({ ...route, projectId })}
      className="h-7 w-auto min-w-36 text-xs"
    />
  )
}

function settingsPage(
  route: Extract<Route, { name: 'settings' }>,
  ctx: PageContext
): React.ReactNode {
  const { project, navigate } = ctx
  const linkedProject = settingsProject(route, ctx)
  const toSettings = (section: SettingsSection): void => navigate({ name: 'settings', section })
  const projectId = project?.id ?? null
  switch (route.section ?? 'integrations') {
    case 'general':
      return <GeneralSection onOpenSection={toSettings} />
    case 'appearance':
      return <AppearanceSection />
    case 'layout':
      return <LayoutSection />
    case 'notifications':
      return <NotificationsSection projects={ctx.projects} />
    case 'shortcuts':
      return <ShortcutsSection isMac={ctx.isMac} />
    case 'terminal':
      return <TerminalSection isMac={ctx.isMac} />
    case 'providers':
      return <ProvidersSection onOpenSection={toSettings} />
    case 'skills':
      return <SkillsPage projectId={projectId} />
    case 'mcp':
      return <McpPage projectId={projectId} />
    case 'secrets':
      return <SecretsPage projectId={projectId} />
    case 'diagnostics':
      return <DiagnosticsSection />
    case 'integrations':
      return <IntegrationsPage projectId={projectId} />
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
          key={linkedProject?.id ?? 'none'}
          project={linkedProject}
          tab={route.tab ?? 'columns'}
          onTabChange={(tab) => ctx.replace({ ...route, tab })}
          onOpenBoard={() =>
            navigate(
              linkedProject ? { name: 'board', projectId: linkedProject.id } : { name: 'board' }
            )
          }
          onOpenProjects={() => toSettings('projects')}
        />
      )
    case 'agents':
      return linkedProject ? (
        <ProjectAgentsSettings key={linkedProject.id} projectId={linkedProject.id} />
      ) : (
        <AgentsPage />
      )
    case 'updates':
      return (
        <div className={`flex flex-col gap-7 ${PAGE_WIDTH.form}`}>
          <PageHeader
            title={SETTINGS_TITLES.updates}
            subtitle="Versão, canal e o que acontece quando sai uma nova."
          />
          <UpdatesSection />
          <PowerSection />
        </div>
      )
    case 'about':
      return (
        <div className={`flex flex-col gap-7 ${PAGE_WIDTH.form}`}>
          <PageHeader title={SETTINGS_TITLES.about} subtitle="O app, a versão e os links." />
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
  board: (route, ctx) => ({
    node: (
      <BoardPage
        route={route}
        onRoute={ctx.replace}
        project={ctx.projects === null ? null : ctx.linkedProject}
        linkedProjects={(ctx.projects ?? []).filter((p) => p.notionProject)}
        chooseProject={ctx.chooseProject}
        onOpenIntegrations={() => ctx.navigate({ name: 'settings', section: 'integrations' })}
        onOpenProjects={() => ctx.navigate({ name: 'settings', section: 'projects' })}
        onOpenBoardSettings={(projectId) =>
          ctx.navigate({ name: 'settings', section: 'board', tab: 'columns', projectId })
        }
        onOpenTask={ctx.openTask}
      />
    ),
    crumbs: null,
    fullHeight: true,
    width: 'full'
  }),
  task: (route, ctx) => ({
    node: (
      <TaskScreen
        project={ctx.projects === null ? null : ctx.linkedProject}
        taskId={route.taskId}
        section={route.section ?? null}
        onBackToBoard={() => ctx.navigate({ name: 'board', projectId: route.projectId })}
        onOpenTerminal={() =>
          ctx.navigate({ name: 'terminal', projectId: route.projectId, taskId: route.taskId })
        }
      />
    ),
    crumbs: null,
    fullHeight: true,
    width: 'wide'
  }),
  terminal: (route, ctx) => ({
    node: (
      <TerminalPage
        projectId={route.projectId}
        taskId={route.taskId}
        startClaude={route.start === 'claude'}
        onStarted={() =>
          ctx.replace({ name: 'terminal', projectId: route.projectId, taskId: route.taskId })
        }
        onOpenTask={() =>
          ctx.navigate({ name: 'task', projectId: route.projectId, taskId: route.taskId })
        }
      />
    ),
    crumbs: null,
    fullHeight: true,
    width: 'full'
  }),
  terminals: (_route, ctx) => ({
    node: (
      <TerminalsPage
        project={ctx.project ? { id: ctx.project.id, name: ctx.project.name } : null}
        onOpenTask={(projectId, taskId) => ctx.navigate({ name: 'terminal', projectId, taskId })}
      />
    ),
    crumbs: null,
    fullHeight: true,
    width: 'full'
  }),
  agents: (_route, ctx) => ({
    node: <AgentsPage projectId={ctx.linkedProject?.id ?? null} />,
    crumbs: null,
    fullHeight: false
  }),
  settings: (route, ctx) => {
    const section = route.section ?? 'integrations'
    const { navigate } = ctx
    const linkedProject = settingsProject(route, ctx)
    const perProject = section === 'board' || section === 'agents'
    return {
      node: (
        <SettingsLayout
          section={section}
          projectName={linkedProject?.name ?? null}
          scope={settingsScope(section, linkedProject?.name ?? null)}
          {...(perProject
            ? { scopePicker: <SettingsProjectPicker route={route} ctx={ctx} /> }
            : {})}
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
                onClick: linkedProject
                  ? () => navigate({ name: 'board', projectId: linkedProject.id })
                  : undefined
              }
            ]
          : []),
        SETTINGS_TITLES[section]
      ],
      fullHeight: true,
      width: 'full'
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

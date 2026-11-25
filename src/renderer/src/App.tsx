import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import { routeForTaskRef, type Route } from './app/routes'
import { CommandMenu, type CommandData } from './app/CommandMenu'
import {
  APP_COMMANDS,
  commandForKey,
  paletteCommands,
  type CommandContext,
  type CommandState,
  type PaletteMode
} from './app/commands'
import { isTextField } from './app/keys'
import { initialRoute } from './app/initial-route'
import { useSidebarData } from './app/useSidebarData'
import { useSetupPending } from './app/useSetupPending'
import { WaitingBell } from './app/WaitingBell'
import { Sidebar } from './app/Sidebar'
import { AccountMenu, useAccount } from './app/AccountMenu'
import { AppBar } from './app/AppBar'
import { AppMenus } from './app/AppMenus'
import { Dock } from './app/Dock'
import { TabStrip } from './app/TabStrip'
import { UsageMeter } from './app/UsageMeter'
import { ShortcutsDialog } from './app/ShortcutsDialog'
import { renderScreen, type PageContext } from './app/ScreenPages'
import { activeTab, currentRoute, type Tab, type TabsAction } from './app/tabs'
import {
  EMPTY_DESKTOPS,
  MAX_DESKTOPS,
  activeDesktop,
  desktopsReducer,
  loadSavedDesktops,
  serializeDesktops,
  visiblePanels
} from './app/desktops'
import { DesktopPanels } from './app/DesktopPanels'
import { ArrangementMenu, DesktopSwitcher, RenameDesktopDialog } from './app/DesktopBar'
import { useSources } from './app/sources'
import { useProjects } from './features/projects/useProjects'
import { useConnection, useConnectionStatus } from './features/integrations/useConnection'
import { ScreenFrame } from './app/ScreenBar'
import { UpdateBanner } from './features/settings/UpdateBanner'
import { WhatsNewDialog } from './features/settings/WhatsNewDialog'
import type { BoardTaskRef } from '../../shared/overview'
import type { ReleaseNotes } from '../../shared/updates'
import { ipcCall, ipcResult, useSource } from './lib/ipc'
import { isMac as detectMac } from './lib/platform'

/** Preferências de interface (não secretas), neste computador. */
const CURRENT_PROJECT_KEY = 'orkio.currentProject'
/** Abas de antes dos desktops (Fase 5): migradas para o "Desktop 1" e apagadas. */
const LEGACY_TABS_KEY = 'orkio.tabs'
const DESKTOPS_KEY = 'orkio.desktops'
const SIDEBAR_KEY = 'orkio.sidebar'

function readJson(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function routeProjectId(route: Route | null): string | undefined {
  return route && 'projectId' in route ? route.projectId : undefined
}

export function App(): React.JSX.Element | null {
  const [desktops, dispatchDesktops] = useReducer(desktopsReducer, EMPTY_DESKTOPS)
  const desktop = activeDesktop(desktops)
  const tabs = desktop.tabs
  const dispatch = useCallback(
    (action: TabsAction) => dispatchDesktops({ type: 'tabs', action }),
    []
  )
  const [desktopsOpen, setDesktopsOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // A primeira tela é decidida por um `reset` (abaixo); até lá, nada na tela.
  const ready = tabs.tabs.length > 0 || tabs.overlay !== null
  const route = currentRoute(tabs)
  const navigate = useCallback(
    (next: Route) => dispatch({ type: 'navigate', route: next }),
    [dispatch]
  )
  const isMac = detectMac()
  const projects = useProjects().projects
  /** Projetos com página no Notion (onde há tarefas para buscar). */
  const linkedProjects = useMemo(() => (projects ?? []).filter((p) => p.notionProject), [projects])
  const [chosenProject, setChosenProject] = useState<string | null>(() =>
    window.localStorage.getItem(CURRENT_PROJECT_KEY)
  )

  const fromRoute = routeProjectId(route)
  const project = !projects
    ? null
    : (projects.find((p) => p.id === fromRoute) ??
      projects.find((p) => p.id === chosenProject) ??
      projects[0] ??
      null)
  const linkedProject = project?.notionProject ? project : null

  const chooseProject = useCallback((id: string) => {
    setChosenProject(id)
    window.localStorage.setItem(CURRENT_PROJECT_KEY, id)
  }, [])

  const sidebar = useSidebarData(linkedProject?.id ?? null)
  const setupMissing = useSetupPending(project, sidebar.board)
  const account = useAccount()
  const github = useConnection('github')
  const notion = useConnection('notion')
  const notionStatus = useConnectionStatus('notion')
  const githubStatus = useConnectionStatus('github')
  // "Sair": o Orkio não tem login próprio; sair = desconectar GitHub e Notion deste computador.
  const signOut = async (): Promise<void> => {
    await Promise.all([github.disconnect(), notion.disconnect()])
    navigate({ name: 'setup', ...(project ? { projectId: project.id } : {}) })
  }

  // Primeira tela: as abas da última vez voltam, e a tela inicial decide qual fica na frente
  // (Primeiros passos sem projeto; a tarefa que espera você; senão o Quadro).
  const decided = useRef(false)
  useEffect(() => {
    if (decided.current || projects === null) return
    if (projects.length > 0 && linkedProject && sidebar.snapshot === null) return
    decided.current = true
    const saved = loadSavedDesktops(readJson(DESKTOPS_KEY), readJson(LEGACY_TABS_KEY))
    if (saved) dispatchDesktops({ type: 'restore', saved })
    dispatch({
      type: 'reset',
      route: initialRoute({
        projectCount: projects.length,
        currentProjectId: linkedProject?.id ?? null,
        groups: sidebar.groups
      })
    })
  }, [projects, linkedProject, sidebar.snapshot, sidebar.groups, dispatch])

  useEffect(() => {
    if (!ready || tabs.tabs.length === 0) return
    window.localStorage.setItem(DESKTOPS_KEY, JSON.stringify(serializeDesktops(desktops)))
    window.localStorage.removeItem(LEGACY_TABS_KEY)
  }, [ready, tabs, desktops])

  const openTask = useCallback(
    (ref: BoardTaskRef) => {
      chooseProject(ref.projectId)
      navigate(routeForTaskRef(ref))
    },
    [chooseProject, navigate]
  )
  useEffect(() => window.orkio.board.onOpenTask(openTask), [openTask])

  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.localStorage.getItem(SIDEBAR_KEY) !== '0'
  )
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      window.localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1')
      return !open
    })
  }, [])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [notes, setNotes] = useState<ReleaseNotes | null>(null)

  const { claudeUsage, overview } = useSources()
  const usage = useSource(claudeUsage, '').value
  const setUsageMeter = useCallback(
    (on: boolean) => {
      claudeUsage.set('', (v) => (v ? { ...v, enabled: on, usage: on ? v.usage : null } : v))
      void ipcCall(() => window.orkio.usage.setEnabled(on), !on).then(() => claudeUsage.reload(''))
    },
    [claudeUsage]
  )

  const waiting = sidebar.snapshot?.waiting ?? []
  const active = activeTab(tabs)
  const commandState: CommandState = {
    isMac,
    route,
    hasProject: linkedProject !== null,
    projectCount: projects?.length ?? 0,
    tabCount: tabs.tabs.length,
    canBack: (active?.router.history.length ?? 0) > 0 && !tabs.overlay,
    canReopen: tabs.closed.length > 0,
    sidebarOpen,
    usageMeter: usage?.enabled !== false,
    waiting: waiting.length,
    // Sem resposta ainda = não oferece "Conectar" (evita piscar).
    notionConnected: notionStatus === null || notionStatus.state === 'connected',
    githubConnected: githubStatus === null || githubStatus.state === 'connected',
    desktops: {
      list: desktops.desktops.map((d) => ({ id: d.id, name: d.name })),
      index: desktops.desktops.indexOf(desktop),
      arrangement: desktop.arrangement
    }
  }
  const ctx: CommandContext = {
    ...commandState,
    navigate,
    tabs: dispatch,
    palette: setPalette,
    toggleSidebar,
    setUsageMeter,
    openWaiting: () => {
      const first = waiting[0]
      if (first) {
        openTask({
          projectId: first.task.projectId,
          taskId: first.task.taskId,
          section: first.section
        })
      }
    },
    refresh: () =>
      void ipcResult(() => window.orkio.overview.refresh()).then(
        (r) => r.ok && overview.set('', r.value)
      ),
    showShortcuts: () => setShortcutsOpen(true),
    showWhatsNew: () =>
      void ipcCall(() => window.orkio.updates.releaseNotes(), null).then((n) =>
        setNotes(n ?? { version: '', notes: '' })
      ),
    checkUpdates: () => {
      navigate({ name: 'settings', section: 'updates' })
      void ipcCall(() => window.orkio.updates.check(), null)
    },
    desktop: dispatchDesktops,
    showDesktops: () => setDesktopsOpen(true),
    renameDesktop: () => setRenaming(true)
  }
  const ctxRef = useRef(ctx)
  useLayoutEffect(() => {
    ctxRef.current = ctx
  })

  // Atalhos globais, do registro de comandos (o mesmo dos menus e da paleta).
  const inShell = ready && route?.name !== 'setup'
  useEffect(() => {
    if (!inShell) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const current = ctxRef.current
      const command = commandForKey(
        APP_COMMANDS,
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          inTextField: isTextField(e.target)
        },
        current
      )
      if (!command) return
      e.preventDefault()
      // A paleta abre e fecha pelo mesmo atalho.
      if (command.id === 'palette' && palette) setPalette(null)
      else command.run(current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inShell, palette])

  const runPaletteItem = (item: CommandData): void => {
    if (item.commandId) {
      APP_COMMANDS.find((c) => c.id === item.commandId)?.run(ctx)
      return
    }
    if (item.url) {
      void window.orkio.openExternal(item.url)
      return
    }
    if (item.projectId) {
      chooseProject(item.projectId)
      navigate(
        route?.name === 'task' || route?.name === 'setup' || !route ? { name: 'board' } : route
      )
      return
    }
    if (!item.route) return
    const target = routeProjectId(item.route)
    if (target) chooseProject(target)
    navigate(item.route)
  }

  if (!ready || !route) return null

  /**
   * O que cada painel recebe: o projeto da rota dele (numa divisão, a tarefa de outro projeto ao
   * lado continua com o projeto certo) e o "trocar a rota sem remontar" da própria aba.
   */
  const pageCtxFor = (tab: Tab | null): PageContext => {
    const own = tab ? routeProjectId(tab.router.route) : undefined
    const p = (own && projects?.find((x) => x.id === own)) || project
    return {
      projects,
      project: p,
      linkedProject: p?.notionProject ? p : null,
      snapshot: sidebar.snapshot,
      isMac,
      navigate,
      replace: (next) => dispatch({ type: 'replace', route: next, ...(tab ? { id: tab.id } : {}) }),
      chooseProject,
      openTask,
      palette: setPalette
    }
  }

  if (route.name === 'setup') return <>{renderScreen(route, pageCtxFor(null)).node}</>

  const shown = visiblePanels(desktop)
  const panels = shown.map((tab) => {
    const view = renderScreen(tab.router.route, pageCtxFor(tab))
    const keyed = <Fragment key={`${desktop.id}:${tab.id}:${tab.router.key}`}>{view.node}</Fragment>
    return {
      id: tab.id,
      active: tab.id === active?.id,
      content: (
        <ScreenFrame key={`${desktop.id}:${tab.id}`} crumbs={view.crumbs}>
          {view.fullHeight ? (
            <div className="h-full min-h-0">{keyed}</div>
          ) : (
            <div className="h-full min-h-0 overflow-y-auto px-6 py-5">{keyed}</div>
          )}
        </ScreenFrame>
      )
    }
  })
  const accountMenu = (variant: 'row' | 'avatar'): React.JSX.Element => (
    <AccountMenu
      account={account}
      variant={variant}
      onOpenIntegrations={() => navigate({ name: 'settings', section: 'integrations' })}
      onOpenSettings={() => navigate({ name: 'settings' })}
      onSignOut={signOut}
    />
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AppBar
        isMac={isMac}
        onPalette={() => setPalette('all')}
        menus={<AppMenus commands={APP_COMMANDS} ctx={ctx} />}
        meter={
          usage?.enabled !== false && (
            <UsageMeter usage={usage?.usage ?? null} onHide={() => setUsageMeter(false)} />
          )
        }
        bell={<WaitingBell snapshot={sidebar.snapshot} onOpen={openTask} />}
        account={accountMenu('avatar')}
      />
      <UpdateBanner
        {...(route.name === 'settings'
          ? {}
          : { onOpenSettings: () => navigate({ name: 'settings', section: 'updates' }) })}
      />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Navegação principal" className="flex h-full shrink-0">
          <Dock
            route={route}
            isMac={isMac}
            sidebarOpen={sidebarOpen}
            onOpen={(screen) => navigate(screen.route)}
            onToggleSidebar={toggleSidebar}
          />
          {sidebarOpen && (
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
              onManageProjects={() => navigate({ name: 'settings', section: 'projects' })}
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
              account={accountMenu('row')}
            />
          )}
        </nav>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabStrip
            tabs={tabs.tabs}
            activeId={tabs.activeId}
            visibleIds={new Set(shown.map((t) => t.id))}
            isMac={isMac}
            dispatch={dispatch}
            moveTargets={{
              desktops: desktops.desktops
                .filter((d) => d.id !== desktop.id)
                .map((d) => ({ id: d.id, name: d.name })),
              canCreate: desktops.desktops.length < MAX_DESKTOPS,
              onMove: (tabId, to) => dispatchDesktops({ type: 'move-tab', tabId, to })
            }}
            start={
              <DesktopSwitcher
                desktops={desktops.desktops}
                activeId={desktop.id}
                isMac={isMac}
                open={desktopsOpen}
                onOpenChange={setDesktopsOpen}
                dispatch={dispatchDesktops}
                onRename={() => setRenaming(true)}
              />
            }
            end={<ArrangementMenu arrangement={desktop.arrangement} dispatch={dispatchDesktops} />}
          />
          <DesktopPanels
            arrangement={desktop.arrangement}
            panels={panels}
            onActivate={(id) => dispatch({ type: 'activate', id })}
          />
        </main>
      </div>
      <CommandMenu
        isOpen={palette !== null}
        onOpenChange={(open) => setPalette(open ? (palette ?? 'all') : null)}
        mode={palette ?? 'all'}
        projects={palette === 'projects' ? (projects ?? []) : linkedProjects}
        currentProjectId={project?.id ?? null}
        commands={paletteCommands(APP_COMMANDS, commandState)}
        commandState={commandState}
        onRun={runPaletteItem}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        commands={APP_COMMANDS}
        ctx={commandState}
        onClose={() => setShortcutsOpen(false)}
      />
      <RenameDesktopDialog
        desktop={renaming ? desktop : null}
        onClose={() => setRenaming(false)}
        onSave={(name) => dispatchDesktops({ type: 'rename', id: desktop.id, name })}
      />
      {notes && <WhatsNewDialog notes={notes} closeLabel="Fechar" onClose={() => setNotes(null)} />}
    </div>
  )
}

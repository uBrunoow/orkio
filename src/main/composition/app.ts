/**
 * Composição do processo main, em fases explícitas:
 *
 * 1. `createApp()` cria todos os serviços e os handlers de IPC (nada roda ainda: sem timers,
 *    watchers nem filas). Ciclos entre serviços usam `late()` (lança se usado cedo) ou eventos
 *    assinados depois de o assinante existir.
 * 2. `start()` espera a config (`configReady`) e liga o que roda sozinho, numa ordem só.
 * 3. `stop({ waitMs })` é o único desligamento (fechar o app e instalar atualização).
 *
 * O banco local pode faltar (versão futura, arquivo ilegível): aí `work` é `null` e cada canal que
 * precisa dele responde o fallback.
 */
import { stat, readFile, realpath, writeFile } from 'node:fs/promises'
import { release as osRelease, userInfo } from 'node:os'
import {
  app,
  BrowserWindow,
  dialog,
  nativeImage,
  Notification,
  powerSaveBlocker,
  safeStorage,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { AgentError, AgentsService } from '../agents/agents.service'
import { agentDisplayName } from '../../shared/agent-presets'
import { FlowError } from '../flows/flow-runner'
import { redactSecrets } from '../platform/redact'
import { TaskSetupService } from '../task-setup/task-setup.service'
import { taskSetupHandlers } from '../ipc/task-setup.ipc'
import { AutomationService, type AutomationNotification } from '../automation/automation.service'
import { GitFlowService } from '../git-flow/git-flow.service'
import { GitFlowStore } from '../git-flow/git-flow.store'
import { AutomationScheduler } from '../automation/scheduler'
import { BoardService } from '../board/board.service'
import { BoardStore } from '../board/board.store'
import { createEnterStage } from '../board/stage-entry'
import { createGitHubClient } from '../connectors/github/github.client'
import { GitHubConnector } from '../connectors/github/github.connector'
import { createGitHubDeviceApi, readGitHubOAuthConfig } from '../connectors/github/github.oauth'
import { OrkioBotService } from '../connectors/github/orkio-bot'
import { GitHubReviewPoster } from '../connectors/github/review-poster'
import { GhCli } from '../connectors/github/gh-cli'
import { GhReviewPoster } from '../connectors/github/gh-review-poster'
import { moveToReviewedIfReviewing } from '../delivery/review-self'
import { createNotionClient } from '../connectors/notion/notion.client'
import { NotionConnector, type NotionOAuthDeps } from '../connectors/notion/notion.connector'
import {
  NOTION_OAUTH_REDIRECT_URI,
  NOTION_OAUTH_TIMEOUT_MS,
  buildNotionAuthorizeUrl,
  createNotionOAuthBroker,
  readNotionOAuthConfig
} from '../connectors/notion/notion.oauth'
import {
  ORKIO_CONFIG_FILE,
  ORKIO_CONFIG_VERSION,
  createOrkioConfigStore,
  type ConfigMigrationNote,
  type OrkioConfig
} from '../config/orkio-config'
import { automationProjectIds, projectById } from '../config/queries'
import { openDatabase } from '../db/database'
import { createDeliveryActions } from '../delivery/delivery-actions'
import { createPublishReviewAction } from '../delivery/review-publish'
import { collectDiagnostics } from '../diagnostics/diagnostics'
import { errorName } from '../errors'
import type { FlowRunner } from '../flows/flow-runner'
import { createGit } from '../git/git'
import { agentsHandlers } from '../ipc/agents.ipc'
import { AgentMemoryStore } from '../agents/agent-memory.store'
import { boardHandlers } from '../ipc/board.ipc'
import { createEmitter, type Emit } from '../ipc/emit'
import { flowHandlers, type FlowFiles } from '../ipc/flow.ipc'
import { githubHandlers } from '../ipc/github.ipc'
import { notionHandlers } from '../ipc/notion.ipc'
import { notionWorkspaceHandlers } from '../ipc/notion-workspace.ipc'
import { overviewHandlers } from '../ipc/overview.ipc'
import { projectsHandlers } from '../ipc/projects.ipc'
import type { Handlers } from '../ipc/register'
import { openExternalHandler, siteLinks, siteUrlRules } from '../ipc/shell.ipc'
import { signalsHandlers } from '../ipc/signals.ipc'
import { claudeHandlers } from '../ipc/claude.ipc'
import { terminalHandlers } from '../ipc/terminal.ipc'
import { serversHandlers } from '../ipc/servers.ipc'
import { updatesHandlers } from '../ipc/updates.ipc'
import { NotionWorkspaceService } from '../notion/notion-workspace.service'
import { authorizeViaLoopback } from '../oauth/loopback'
import { OrchestratorService } from '../orchestrator/orchestrator.service'
import { applyWaitingBadge, overlayDotBitmap } from '../overview/badge'
import { OverviewService } from '../overview/overview.service'
import { withDialogWindow } from '../platform/dialog'
import { userDataPaths, type UserDataPaths } from '../platform/paths'
import { execExitCode, toolEnv } from '../platform/process'
import { allowsLoopbackSite, siteOrigin } from '../platform/site'
import { KeepAwake } from '../power/keep-awake'
import { ClaudeUsageService, readClaudeCredentials } from '../claude/usage'
import { usageHandlers } from '../ipc/usage.ipc'
import { ProjectsService } from '../projects/projects.service'
import { createReviewActions } from '../signals/review-action'
import { createReviewRoundActions } from '../flows/review-round-actions'
import { ReviewThreadsService } from '../signals/review-threads'
import { TaskSignalsService } from '../signals/task-signals.service'
import type { ConfigStore } from '../storage/config-store'
import { SecureStore } from '../storage/secure-store'
import type { AutomationStatus } from '../../shared/automation'
import { readRepoOf, repoAccess } from '../../shared/projects'
import { finalText } from '../../shared/review-publish'
import { createClaude, createWorktrees, type ClaudeParts } from './claude'
import { createFlows } from './flows'
import type { PrWakeService } from '../flows/pr-wake'
import { createSliceActions } from '../flows/slice-actions'
import { prWatchOf } from '../../shared/pr-wake'
import { usageHoldOf, USAGE_HOLD_DEFAULT } from '../../shared/claude-usage'
import { late } from './late'
import { createStop, type StopOptions } from './lifecycle'
import { createUpdates } from './updates'
import { homedir } from 'node:os'
import { VaultService } from '../vault/vault.service'
import { McpService } from '../mcp/mcp.service'
import { claudeJsonPath } from '../mcp/claude-mcp'
import { resolveRunExtras, type RunExtras } from '../mcp/run-extras'
import { SkillsService } from '../settings/skills.service'
import {
  PreferencesService,
  notificationAllowed,
  storageUsage
} from '../settings/preferences.service'
import { buildCatalog } from '../claude/catalog'
import { applyGlobalShortcut, clearGlobalShortcut } from '../platform/global-shortcut'
import { mcpHandlers, prefsHandlers, skillsHandlers, vaultHandlers } from '../ipc/settings.ipc'
import type { AppPreferences } from '../../shared/preferences'

/** Ao instalar uma atualização: quanto esperar as execuções do Claude Code saírem. */
const UPDATE_SHUTDOWN_WAIT_MS = 12_000

export interface OrkioApp {
  handlers: Handlers
  /** Config carregada e estado do banco retomado: os canais de IPC esperam por isto. */
  ready: Promise<void>
  start(): Promise<void>
  stop(options: StopOptions): Promise<void>
}

/** Peças que só existem com o banco local. */
interface Work {
  board: BoardService
  /** Fluxo Git: a Etapa Git no Notion pela fila própria. */
  gitFlow: GitFlowService
  claude: ClaudeParts
  flows: FlowRunner
  prWake: PrWakeService
  scheduler: AutomationScheduler
  overview: OverviewService
  handlers: Pick<
    Handlers,
    | 'board'
    | 'flow'
    | 'automation'
    | 'alva'
    | 'agents'
    | 'taskFlows'
    | 'taskSetup'
    | 'claude'
    | 'terminal'
    | 'servers'
    | 'overview'
  >
}

export function createApp(): OrkioApp {
  const paths = userDataPaths(app.getPath('userData'), ORKIO_CONFIG_FILE)
  const env = toolEnv()
  const git = createGit()
  const actor = (): string => userInfo().username
  const site = siteOrigin(import.meta.env)

  const overviewRef = late<OverviewService | null>('Visão geral')
  const keepAwakeRef = late<KeepAwake>('Manter acordado')
  const emit = createEmitter({
    windows: () => BrowserWindow.getAllWindows(),
    effects: {
      overview: () => overviewRef()?.touch(),
      keepAwake: () => keepAwakeRef().evaluate()
    }
  })
  // Fase 4: avisos do sistema seguem Configurações › Notificações (a config carrega antes de
  // qualquer aviso: nada notifica antes do `start()`).
  const prefsRef = late<PreferencesService>('Preferências')
  const notifyPrefs = (): AppPreferences => prefsRef().get()
  const notify = (title: string, body: string, ref: { projectId: string; taskId: string }): void =>
    showNotification(
      { title, body, projectId: ref.projectId, taskId: ref.taskId },
      emit,
      notifyPrefs()
    )

  const secrets = new SecureStore(paths.secrets, safeStorage)
  const notion = new NotionConnector({
    store: secrets,
    client: createNotionClient(),
    oauth: createNotionOAuthDeps(site)
  })
  const githubConfig = readGitHubOAuthConfig(import.meta.env)
  const github = new GitHubConnector({
    store: secrets,
    client: createGitHubClient(),
    // Device Flow não usa client secret nem o site.
    device: githubConfig ? createGitHubDeviceApi(githubConfig) : null,
    oauthClientId: githubConfig?.clientId ?? null,
    // Revisão como orkio[bot]: único destino do token do usuário fora do GitHub, fixado aqui.
    siteOrigin: site,
    allowLoopbackSite: allowsLoopbackSite(import.meta.env)
  })

  // Uma instância só: Projetos, bancos do Notion, quadro etc. escrevem no mesmo arquivo. A carga é
  // daqui (`configReady`); migrações que mudam fluxos (v11 → v12) avisam e o histórico vai ao banco
  // no `start()`.
  const migrationNotes: ConfigMigrationNote[] = []
  const configStore = createOrkioConfigStore(paths.config, {
    onMigrationNote: (note) => migrationNotes.push(note)
  })
  const configReady = configStore.load().then(() => undefined)

  // Fase 4: Segredos (valores no SecureStore), servidores MCP e skills (config) e preferências.
  const vault = new VaultService({ store: secrets, config: configStore })
  const mcp = new McpService({
    config: configStore,
    vault,
    claudeSources: () => ({
      claudeJson: claudeJsonPath(process.env, homedir()),
      projects: configStore
        .get()
        .projects.map((p) => ({ id: p.id, name: p.name, localPath: p.localPath }))
    })
  })
  const skills = new SkillsService({
    config: configStore,
    catalog: (projectDir) => buildCatalog({ projectDir })
  })
  const preferences = new PreferencesService({
    config: configStore,
    onChange: (p) => void applyGlobalShortcut(p.globalShortcut)
  })
  prefsRef.set(preferences)
  const runExtras = (run: { projectId: string; agentKey: string | null }): Promise<RunExtras> =>
    resolveRunExtras(
      {
        servers: () => configStore.get().mcpServers ?? [],
        skillsDisabled: (projectId) => skills.disabled(projectId),
        vault
      },
      run
    )

  const projects = new ProjectsService({
    store: configStore,
    git,
    // O token fica no conector; o serviço só pede dados do repositório.
    github: {
      isConnected: () => github.isConnected(),
      getRepository: (owner, name) => github.getRepository(owner, name),
      accessSettingsUrl: () => github.accessSettingsUrl()
    },
    pickFolder: async (purpose) => {
      const result = await withDialogWindow(dialog.showOpenDialog, {
        title: purpose === 'add' ? 'Escolha a pasta do projeto' : 'Escolha a nova pasta do projeto',
        buttonLabel: 'Usar esta pasta',
        properties: ['openDirectory']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    folderExists: async (path) => (await stat(path)).isDirectory(),
    realpath: (path) => realpath(path)
  })
  const notionWorkspace = new NotionWorkspaceService({
    store: configStore,
    // O token fica no conector; o serviço só pede leituras.
    notion: {
      connectionMethod: () => notion.connectionMethod(),
      searchDataSources: (options) => notion.searchDataSources(options),
      getDataSource: (id) => notion.getDataSource(id),
      queryDataSource: (id, options) => notion.queryDataSource(id, options),
      currentPersonId: () => notion.currentPersonId()
    }
  })
  const orkioBot = new OrkioBotService({
    isConnected: () => github.isConnected(),
    listProjects: async () => (await projects.list()).projects,
    installation: (owner, repo) => github.orkioBotInstallation(owner, repo)
  })

  const boardStore = openBoardStore(paths.db)
  // Branches registradas por tarefa (banco sem ID no Notion): os sinais leem daqui.
  const worktrees = boardStore ? createWorktrees({ db: boardStore.db, git, paths }) : null
  // Projeto só com git local: o GitHub vem pelo `gh` do usuário (o token dele nunca entra aqui).
  const gh = new GhCli()
  const signals = new TaskSignalsService({
    store: configStore,
    git,
    gh: {
      status: () => gh.status(),
      getConditional: (path, etag) => gh.getConditional(path, etag),
      graphql: (query, variables) => gh.graphql(query, variables)
    },
    // O token fica no conector; o serviço só faz leituras de repositório.
    github: {
      isConnected: () => github.isConnected(),
      accessSettingsUrl: () => github.accessSettingsUrl(),
      getConditional: (path, etag) => github.getConditional(path, etag),
      graphql: (query, variables) => github.graphql(query, variables)
    },
    listTasks: (projectId) => notionWorkspace.listTasks(projectId),
    linkedBranches: (projectId) => worktrees?.linkedBranchesByTask(projectId) ?? new Map()
  })
  const reviewThreads = new ReviewThreadsService({
    graphql: (query, variables, via) =>
      via === 'gh' ? gh.graphql(query, variables) : github.graphql(query, variables),
    isConnected: (via) => (via === 'gh' ? gh.status().then((s) => s.ok) : github.isConnected()),
    locate: (projectId, taskId) => {
      const repo = readRepoOf(projectById(configStore.get(), projectId))
      if (!repo) return null
      const pr = signals.cached(projectId)?.signals[taskId]?.pr ?? null
      return {
        owner: repo.owner,
        repo: repo.name,
        via: repo.via,
        pr: pr ? { number: pr.number, url: pr.url } : null
      }
    },
    refresh: async (projectId) => void (await signals.get(projectId))
  })

  // Medidor de uso do Claude (experimental): token lido na hora, só no main.
  const claudeUsage = new ClaudeUsageService({
    enabled: () => configStore.get().usageMeter !== false,
    readCredentials: () => readClaudeCredentials()
  })
  // Fase 5: o uso do Claude decide quando a automação roda (medidor desligado/falhando = roda).
  const usageHold = async (): Promise<string | null> => {
    const config = configStore.get()
    if (config.usageMeter === false) return null
    const held = usageHoldOf(config.usageHold ?? USAGE_HOLD_DEFAULT, await claudeUsage.get())
    if (!held) return null
    const at = held.resetsAt
      ? ` (renova às ${new Date(held.resetsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`
      : ''
    return `A janela de 5 horas do Claude está em ${held.percent}%${at}. A automação espera renovar.`
  }

  const work: Work | null =
    boardStore && worktrees
      ? createWork({
          boardStore,
          worktrees,
          configStore,
          paths,
          env,
          git,
          actor,
          emit,
          notify,
          notifyPrefs,
          runExtras,
          projects,
          notion,
          github,
          notionWorkspace,
          signals,
          reviewThreads,
          gh,
          usageHold
        })
      : null
  overviewRef.set(work?.overview ?? null)

  // Troca/criação de branch com checkout: tela e automações (3B) na hora. Os HeadWatchers só
  // ligam no `start()`, depois desta assinatura: nenhum evento se perde.
  projects.onBranchChanged((event) => {
    emit('branchChanged', event)
    work?.scheduler.onLocalChange(event.projectId)
  })

  const keepAwake = new KeepAwake({
    blocker: powerSaveBlocker,
    enabled: () => configStore.get().keepAwake === true,
    busy: () =>
      work !== null &&
      (work.claude.runs.activeRuns().some((r) => !r.queued) || work.flows.runningList().length > 0)
  })
  keepAwakeRef.set(keepAwake)

  // Atualizações automáticas (6C). Funcionam mesmo com a config em modo só leitura ou sem o banco
  // local: é assim que se sai de um downgrade.
  const updates = createUpdates({
    configStore,
    configReady,
    emit,
    busy: () => ({
      runs: work?.claude.runs.activeRuns() ?? [],
      flows: work?.flows.runningList() ?? [],
      pendingWrites:
        (work?.board.writes.pendingCount() ?? 0) + (work?.gitFlow.writes.pendingCount() ?? 0)
    }),
    taskLabel: async (projectId, taskId) => {
      const r = await notionWorkspace.listTasks(projectId)
      return r.ok ? (r.value.tasks.find((t) => t.id === taskId)?.displayId ?? null) : null
    },
    shutdownWork: () => stop({ waitMs: UPDATE_SHUTDOWN_WAIT_MS })
  })

  const stop = createStop(() => ({
    work: work && {
      flows: work.flows,
      runs: work.claude.runs,
      terminals: work.claude.terminals,
      writes: work.board.writes,
      gitFlowWrites: work.gitFlow.writes,
      scheduler: work.scheduler,
      prWake: work.prWake,
      overview: work.overview
    },
    projects,
    keepAwake,
    updates
  }))

  // Depois de autorizar no navegador, traz o Orkio de volta para a frente.
  const focusSender = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }

  const handlers: Handlers = {
    notion: notionHandlers(notion, focusSender, () => emit('notionChanged', {})),
    github: githubHandlers(github, {
      onDeviceFlowFinished: focusSender,
      onChanged: () => emit('githubChanged', {}),
      orkioBot: (force) => orkioBot.status(force)
    }),
    projects: projectsHandlers(projects),
    notionWorkspace: notionWorkspaceHandlers(notionWorkspace),
    signals: signalsHandlers(signals, reviewThreads),
    board: work?.handlers.board ?? null,
    flow: work?.handlers.flow ?? null,
    automation: work?.handlers.automation ?? null,
    alva: work?.handlers.alva ?? null,
    agents: work?.handlers.agents ?? null,
    taskFlows: work?.handlers.taskFlows ?? null,
    taskSetup: work?.handlers.taskSetup ?? null,
    claude: work?.handlers.claude ?? null,
    terminal: work?.handlers.terminal ?? null,
    servers: work?.handlers.servers ?? null,
    overview: work?.handlers.overview ?? null,
    updates: updatesHandlers(
      updates,
      () => ({ version: app.getVersion(), links: siteLinks(site) }),
      // Diagnóstico (Sobre): só versões, contagens e estados, sem rede e sem segredos.
      () =>
        collectDiagnostics({
          app: { version: app.getVersion(), packaged: app.isPackaged },
          runtime: {
            electron: process.versions.electron ?? '—',
            node: process.versions.node,
            chrome: process.versions.chrome ?? '—'
          },
          os: { platform: process.platform, arch: process.arch, release: osRelease() },
          config: { schemaVersion: ORKIO_CONFIG_VERSION, readOnly: configStore.readOnly },
          db: boardStore?.db ?? null,
          flows: work?.flows ?? null,
          runs: work?.claude.runs ?? null,
          board: boardStore,
          connections: async () => [
            { name: 'Notion', status: await notion.getStatus() },
            { name: 'GitHub', status: await github.getStatus() }
          ],
          toolVersion: async (cmd) => {
            const r = await execExitCode(cmd, ['--version'], { env, timeoutMs: 5_000 })
            return r.code === 0 ? r.stdout.split('\n')[0]?.trim() || null : null
          },
          paths,
          projects: () => {
            const c = configStore.get()
            return {
              total: c.projects.length,
              withBoard: c.projects.filter((p) => c.boards[p.id]).length
            }
          },
          automation: () => {
            const ids = work ? automationProjectIds(configStore.get()) : []
            return {
              polling: ids.length,
              failing: ids.filter((id) => work!.scheduler.getStatus(id).failures > 0).length
            }
          }
        })
    ),
    power: {
      keepAwake: () => configStore.get().keepAwake === true,
      setKeepAwake: async (enabled) => {
        await configReady
        if (configStore.readOnly) return configStore.get().keepAwake === true
        await configStore.update((c) => {
          const next = { ...c }
          if (enabled) next.keepAwake = true
          else delete next.keepAwake
          return next
        })
        keepAwake.evaluate()
        return configStore.get().keepAwake === true
      }
    },
    usage: usageHandlers(claudeUsage, configStore),
    vault: vaultHandlers(vault),
    mcp: mcpHandlers(mcp),
    skills: skillsHandlers(skills),
    prefs: prefsHandlers({
      prefs: preferences,
      runs: () => work?.claude.runs ?? null,
      projectName: (projectId) => projectById(configStore.get(), projectId)?.name ?? null,
      storage: () =>
        storageUsage({
          runs: paths.runs,
          worktrees: paths.worktrees,
          agentMemory: paths.agentMemory,
          keepPerTask: 10
        })
    }),
    openExternal: openExternalHandler((url) => shell.openExternal(url), siteUrlRules(site))
  }

  let markReady: (error?: unknown) => void = () => undefined
  const ready = new Promise<void>((resolve, reject) => {
    markReady = (error) => (error === undefined ? resolve() : reject(error))
  })
  ready.catch(() => undefined)

  const start = async (): Promise<void> => {
    try {
      await configReady
    } catch (error) {
      markReady(error)
      throw error
    }
    if (work && boardStore) {
      recordMigrationNotes(boardStore, migrationNotes.splice(0))
      // O que estava rodando quando o app fechou vira "interrompido"; gates voltam a contar.
      work.flows.init()
    }
    markReady()
    // Total inicial de "Esperando você" (badge do ícone e menu lateral).
    work?.overview.touch()
    // Retoma as escritas no Notion que ficaram pendentes quando o app fechou.
    work?.board.writes.start()
    work?.gitFlow.writes.start()
    keepAwake.start()
    updates.start()
    applyGlobalShortcut(preferences.get().globalShortcut)
    app.once('will-quit', clearGlobalShortcut)
    // Eventos locais (troca de branch) na hora; depois, os ciclos das automações.
    await projects.watch().catch((error: unknown) => {
      console.error(`[orkio] HeadWatchers: ${errorName(error)}`)
    })
    work?.scheduler.start()
    work?.prWake.start()
  }

  return { handlers, ready, start, stop }
}

/** Quadro, automações, agentes, orquestrador, Claude Code, fluxos e visão geral (banco local). */
function createWork(core: {
  boardStore: BoardStore
  worktrees: ReturnType<typeof createWorktrees>
  configStore: ConfigStore<OrkioConfig>
  paths: UserDataPaths
  env: NodeJS.ProcessEnv
  git: ReturnType<typeof createGit>
  actor: () => string
  emit: Emit
  notify: (title: string, body: string, ref: { projectId: string; taskId: string }) => void
  notifyPrefs: () => AppPreferences
  runExtras: (run: { projectId: string; agentKey: string | null }) => Promise<RunExtras>
  projects: ProjectsService
  notion: NotionConnector
  github: GitHubConnector
  notionWorkspace: NotionWorkspaceService
  signals: TaskSignalsService
  reviewThreads: ReviewThreadsService
  /** GitHub pelo `gh` do usuário (projetos só com git local). */
  gh: GhCli
  usageHold: () => Promise<string | null>
}): Work {
  const { boardStore, configStore, emit, notion, github, gh, notionWorkspace, signals } = core
  // Ciclos: o quadro avisa a entrada na etapa (orquestrador, agentes, fluxos), que usam o quadro;
  // agentes e Claude Code perguntam ao executor de fluxos, que usa os dois; as ações de entrega
  // pedem um ciclo ao agendador, que roda o orquestrador.
  const enterStage = late<ReturnType<typeof createEnterStage>>('Entrada na etapa')
  const flowRunner = late<FlowRunner>('Executor de fluxos')
  const scheduler = late<AutomationScheduler>('Agendador das automações')
  const runAutomation = (projectId: string): void =>
    void scheduler()
      .runNow(projectId)
      .catch((error: unknown) => console.error(`[orkio] automações: ${errorName(error)}`))

  const agents = new AgentsService({
    db: boardStore.db,
    store: boardStore,
    config: configStore,
    localDir: core.paths.agents,
    hasActiveFlow: (taskId) => flowRunner().hasActive(taskId),
    agentRuns: (key, since) => claude.runs.agentRunsSince(key, since),
    stageIds: (projectId) => configStore.get().boards[projectId]?.stages.map((s) => s.id) ?? [],
    actor: core.actor,
    emit: (projectId) => emit('agentsChanged', { projectId })
  })
  // Fase 3: memória por agente (MEMORY.md em <userData>/agent-memory, fora do projeto).
  const agentMemory = new AgentMemoryStore({ root: core.paths.agentMemory })
  const board = new BoardService({
    config: configStore,
    store: boardStore,
    notion: {
      boardTasks: (projectId, options) => notionWorkspace.boardTasks(projectId, options),
      statusOptions: () => notionWorkspace.statusOptions(),
      invalidateTasks: (projectId) => notionWorkspace.invalidateTasks(projectId),
      updateDataSource: (id, properties) => notion.updateDataSource(id, properties),
      connectionMethod: () => notion.connectionMethod()
    },
    // O token fica no conector.
    writes: { updatePage: (pageId, properties) => notion.updatePage(pageId, properties) },
    onSync: (event) => emit('boardSync', event),
    actor: core.actor,
    enterStage: (change) => enterStage()(change)
  })
  const flowFiles: FlowFiles = {
    save: async (json) => {
      const result = await withDialogWindow(dialog.showSaveDialog, {
        title: 'Exportar fluxo do projeto',
        defaultPath: 'fluxo-orkio.json',
        filters: [{ name: 'Fluxo do Orkio', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, json, 'utf8')
      return true
    },
    open: async (maxBytes) => {
      const result = await withDialogWindow(dialog.showOpenDialog, {
        title: 'Importar fluxo do projeto',
        properties: ['openFile'],
        filters: [{ name: 'Fluxo do Orkio', extensions: ['json'] }]
      })
      const file = result.canceled ? undefined : result.filePaths[0]
      if (!file) return null
      if ((await stat(file)).size > maxBytes) throw new Error('arquivo grande demais')
      return readFile(file, 'utf8')
    }
  }

  // Claude Code (4A): CLI do usuário (assinatura dele), worktree por tarefa, permissões pelo Orkio.
  const claude = createClaude({
    boardStore,
    git: core.git,
    configStore,
    paths: core.paths,
    env: core.env,
    worktrees: core.worktrees,
    listTasks: (projectId) => notionWorkspace.listTasks(projectId),
    signals: (projectId) => signals.get(projectId),
    prFor: (projectId, branch) => signals.prForBranch(projectId, branch)?.number ?? null,
    mergedPrFor: (projectId, branch) => signals.mergedPrForBranch(projectId, branch),
    getBlockChildren: (id, cursor) => notion.getBlockChildren(id, cursor),
    notionInsert: {
      createChildPage: (parent, title, markdown) => notion.createChildPage(parent, title, markdown),
      appendMarkdown: (pageId, markdown) => notion.appendMarkdown(pageId, markdown)
    },
    // 8A: "Rodar como <agente>" (instruções e modelo; mesmas permissões).
    agentFor: (projectId, taskId, command) => agents.runAgentFor(projectId, taskId, command),
    agentInfo: (projectId, taskId) => agents.problemFor(projectId, taskId),
    agentMemory,
    flowRunner,
    notify: core.notify,
    runExtras: core.runExtras,
    emit
  })

  // Fase 1: "Como deve rodar?" (padrão da coluna, troca por tarefa, fluxo nativo e revisor).
  const taskSetup = new TaskSetupService({
    db: boardStore.db,
    config: configStore,
    currentStage: (taskId) => boardStore.state(taskId)?.stageId ?? null,
    assignment: (taskId) => agents.assignment(taskId),
    agentName: async (projectId, key) =>
      (await agents.get(projectId, key).catch(() => null))?.profile?.name ?? agentDisplayName(key),
    runtime: async (projectId, key) => {
      try {
        return await agents.runtimeByKey(projectId, key)
      } catch (error) {
        if (error instanceof AgentError) {
          throw new FlowError(error.code, `Revisor: ${error.message}`)
        }
        throw error
      }
    },
    agentFlow: async (projectId, taskId) => {
      const key = agents.assignedKey(taskId)
      return key ? ((await agents.get(projectId, key))?.profile?.flow ?? null) : null
    },
    hasActiveFlow: (taskId) => flowRunner().hasActive(taskId)
  })

  // Projeto só com git local: pedir review e publicar revisão vão pelo `gh` do usuário; sem o
  // `gh` instalado e logado, recusam com o motivo.
  const isGitOnly = (projectId: string): boolean => {
    const repo = projectById(configStore.get(), projectId)?.repo
    return !!repo && repoAccess(repo) === 'git'
  }
  const gitOnly = async (projectId: string): Promise<boolean> =>
    isGitOnly(projectId) && !(await gh.status().then((s) => s.ok))
  const githubRepo = (projectId: string): { owner: string; repo: string } | null => {
    const repo = readRepoOf(projectById(configStore.get(), projectId))
    return repo ? { owner: repo.owner, repo: repo.name } : null
  }
  const ghPoster = new GhReviewPoster(gh)
  // Autor da PR pelo `gh`: a revisão vai como comentário; em Revisando (e não bloqueada) a tarefa
  // vai para Revisado, como o "alterações pedidas" faria.
  const moveToReviewed = (projectId: string, taskId: string): void =>
    void moveToReviewedIfReviewing(
      {
        store: boardStore,
        board,
        stages: (id) => configStore.get().boards[id]?.stages ?? []
      },
      projectId,
      taskId
    )
  const orchestratorRef = late<OrchestratorService>('Orquestrador')
  const flows = createFlows({
    boardStore,
    configStore,
    paths: core.paths,
    env: core.env,
    board,
    claude,
    agents,
    listTasks: (projectId) => notionWorkspace.listTasks(projectId),
    // Entrega (5C): push/pedir review. O token do GitHub fica no conector.
    deliveryActions: createDeliveryActions({
      delivery: claude.delivery,
      signals: (projectId, force) => signals.get(projectId, { force }),
      github: {
        requestReviewers: (owner, repo, pull, reviewers) =>
          github.requestReviewers(owner, repo, pull, reviewers),
        listCollaborators: (owner, repo) => github.listCollaborators(owner, repo)
      },
      githubFor: (projectId) => (isGitOnly(projectId) ? gh : null),
      store: boardStore,
      runAutomation,
      // Corretor da PR pediu de novo: aplica já a regra de "review pedido" (Revisado → Revisando).
      onReviewRequested: (projectId, taskId, pr) =>
        void automation.applyEvent(projectId, taskId, 'pr.review_requested', pr),
      gitOnly
    }).concat(
      // Revisão: o Orkio lê as threads da PR e grava .orkio/revisao.md no worktree.
      createReviewActions({
        reviews: core.reviewThreads,
        ensureWorktree: (projectId, taskId) => claude.service.ensureWorktreePath(projectId, taskId)
      }),
      // Fase 3: revisão até ficar limpo (diff para o revisor e as rodadas em .orkio/revisao/).
      createReviewRoundActions({
        worktree: (taskId) => {
          const wt = claude.worktrees.get(taskId)
          return wt ? { path: wt.path, baseRef: wt.baseRef } : null
        },
        git: core.git,
        finalText: async (runId) => finalText(await claude.runs.readLog(runId))
      }),
      // Fase 5: o git como checkpoint das fatias (trailer Spec-Slice).
      createSliceActions({
        worktree: (taskId) => {
          const wt = claude.worktrees.get(taskId)
          return wt ? { path: wt.path, baseRef: wt.baseRef } : null
        },
        git: core.git
      }),
      // Revisão do agente publicada na PR como orkio[bot] (pelo site, depois do gate).
      createPublishReviewAction({
        poster: new GitHubReviewPoster({ github }),
        finalText: async (runId) => finalText(await claude.runs.readLog(runId)),
        signals: (projectId, force) => signals.get(projectId, { force }),
        posterFor: (projectId) => (isGitOnly(projectId) ? ghPoster : null),
        onSelfChangesRequested: moveToReviewed,
        repo: githubRepo,
        store: boardStore,
        runAutomation,
        gitOnly
      })
    ),
    actor: core.actor,
    emit,
    notify: core.notify,
    onFlowFinished: (projectId) => orchestratorRef().runSoon(projectId),
    enterStage: (change) => enterStage()(change),
    nativePlan: (projectId, taskId, stageId, manual) =>
      taskSetup.nativePlan(projectId, taskId, stageId, manual),
    lastResult: async (runId) => {
      const text = finalText(await claude.runs.readLog(runId))
      return text ? redactSecrets(text) : null
    },
    prWatch: (projectId, taskId) => prWatchOf(signals.cached(projectId)?.signals[taskId]?.pr),
    usageHold: core.usageHold,
    git: core.git
  })
  flowRunner.set(flows.runner)
  const runner = flows.runner
  const orchestrator = new OrchestratorService({
    config: configStore,
    store: boardStore,
    board,
    agents,
    flows: runner,
    actor: core.actor,
    emit: (projectId) => {
      emit('agentsChanged', { projectId })
      emit('boardChanged', { projectId })
    }
  })
  orchestratorRef.set(orchestrator)
  enterStage.set(createEnterStage({ orchestrator, agents, flows: runner }))

  // Fluxo Git (Etapa Git no Notion): escrita própria, mesmo conector do quadro (o token fica lá).
  const gitFlow = new GitFlowService({
    config: configStore,
    store: boardStore,
    gitStore: new GitFlowStore(boardStore.db),
    stageOptions: () => notionWorkspace.gitStageOptions(),
    writes: { updatePage: (pageId, properties) => notion.updatePage(pageId, properties) },
    onChanged: (projectId) => {
      notionWorkspace.invalidateTasks(projectId)
      emit('boardChanged', { projectId })
    }
  })
  const automation = new AutomationService({
    config: configStore,
    store: boardStore,
    board,
    signals,
    gitFlow,
    notify: (n) => showNotification(n, emit, core.notifyPrefs()),
    onChanged: (projectId) => emit('boardChanged', { projectId })
  })
  scheduler.set(
    new AutomationScheduler({
      run: async (projectId, options) => {
        const result = await automation.run(projectId, options)
        await orchestrator.tick(projectId).catch((error: unknown) => {
          console.error(`[orkio] orquestrador: ${errorName(error)}`)
        })
        return result
      },
      projects: () => automationProjectIds(configStore.get()),
      localBranches: async (projectId) => {
        const project = projectById(configStore.get(), projectId)
        return project ? core.git.localBranches(project.localPath) : null
      }
    })
  )
  const automationStatus = (projectId: string): AutomationStatus => {
    const s = scheduler().getStatus(projectId)
    return {
      paused: configStore.get().automation.paused,
      github: s.github,
      lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
      nextRunAt: s.nextRunAt ? new Date(s.nextRunAt).toISOString() : null,
      error: s.error || null
    }
  }

  // Visão geral (6D): agrega o que já está no app; nunca chama APIs sozinha.
  const overview = new OverviewService({
    board: boardStore,
    runStore: claude.runs,
    worktreeBranch: (taskId) => core.worktrees.get(taskId)?.branch ?? null,
    config: () => configStore.get(),
    projects: async () => (await core.projects.list()).projects,
    flows: () => runner.activeViews(),
    finishedFlows: (since) => runner.recentFinished(since),
    handoffs: () => claude.handoff.all(),
    requests: () => claude.runs.waitingRequests(),
    runs: () => claude.runs.activeRuns(),
    cachedTasks: (projectId) => notionWorkspace.cachedTasks(projectId),
    notionHealth: () => notionWorkspace.cachedHealth(),
    signals: (projectId) => signals.cached(projectId)?.signals ?? null,
    pulls: (projectId) => signals.cachedPulls(projectId),
    refresh: async (projectId) => {
      await scheduler().runNow(projectId)
    },
    changed: (waiting) => {
      applyWaitingBadge(
        {
          platform: process.platform,
          setBadgeCount: (count) => app.setBadgeCount(count),
          windows: () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()),
          overlayIcon: () =>
            nativeImage.createFromBitmap(overlayDotBitmap(), { width: 16, height: 16 })
        },
        waiting
      )
      emit('overviewChanged', { waiting })
    }
  })

  return {
    board,
    gitFlow,
    claude,
    flows: runner,
    prWake: flows.prWake,
    scheduler: scheduler(),
    overview,
    handlers: {
      board: boardHandlers(board),
      flow: flowHandlers(board, flowFiles),
      automation: {
        status: (projectId) => automationStatus(projectId),
        runNow: async (projectId) => {
          await scheduler().runNow(projectId)
          return automationStatus(projectId)
        },
        setPaused: async (projectId, paused) => {
          await configStore.update((c) => ({ ...c, automation: { paused } }))
          return automationStatus(projectId)
        }
      },
      alva: flows.handlers.alva,
      agents: agentsHandlers(agents, orchestrator, agentMemory),
      taskFlows: flows.handlers.taskFlows,
      taskSetup: taskSetupHandlers(taskSetup),
      claude: claudeHandlers(claude.service, claude.runs, claude.handoff),
      terminal: terminalHandlers({
        terminals: claude.terminals,
        hasProject: (projectId) => projectById(configStore.get(), projectId) !== undefined,
        worktreePath: (taskId) => core.worktrees.get(taskId)?.path ?? null,
        projectPath: (projectId) => projectById(configStore.get(), projectId)?.localPath ?? null
      }),
      servers: serversHandlers({
        servers: claude.servers,
        hasProject: (projectId) => projectById(configStore.get(), projectId) !== undefined,
        openExternal: (url) => shell.openExternal(url)
      }),
      overview: overviewHandlers(overview)
    }
  }
}

/** Histórico de configuração das migrações (ex.: fluxos Alva atualizados na v12). */
function recordMigrationNotes(store: BoardStore, notes: ConfigMigrationNote[]): void {
  const at = new Date().toISOString()
  for (const note of notes) {
    try {
      store.addConfigEvent(note.projectId, at, 'Orkio (atualização)', note.changes)
    } catch (error) {
      console.error(`[orkio] histórico da migração: ${errorName(error)}`)
    }
  }
}

/** Notificação de desktop (opcional por regra). Clique: foca o Orkio e abre a tarefa. */
function showNotification(n: AutomationNotification, emit: Emit, prefs: AppPreferences): void {
  if (!Notification.isSupported()) return
  const allowed = notificationAllowed(prefs, n.projectId)
  if (!allowed.show) return
  const notification = new Notification({ title: n.title, body: n.body, silent: allowed.silent })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    emit('openTask', { projectId: n.projectId, taskId: n.taskId })
  })
  notification.show()
}

/** Abre o banco local; versão futura ou arquivo ilegível → quadro indisponível (sem apagar nada). */
function openBoardStore(file: string): BoardStore | null {
  try {
    return new BoardStore(openDatabase(file))
  } catch (error) {
    console.error(`[orkio] banco local indisponível: ${errorName(error)}`)
    return null
  }
}

/** OAuth do Notion só existe se o build tiver client ID e o endereço do site (intermediário). */
function createNotionOAuthDeps(site: string | null): NotionOAuthDeps | null {
  const config = readNotionOAuthConfig(import.meta.env.MAIN_VITE_NOTION_OAUTH_CLIENT_ID, site)
  if (!config) return null
  return {
    redirectUri: NOTION_OAUTH_REDIRECT_URI,
    broker: createNotionOAuthBroker(config),
    authorize: (signal) =>
      authorizeViaLoopback({
        redirectUri: NOTION_OAUTH_REDIRECT_URI,
        providerName: 'Notion',
        timeoutMs: NOTION_OAUTH_TIMEOUT_MS,
        signal,
        buildAuthorizeUrl: (state) => buildNotionAuthorizeUrl(config.clientId, state),
        // URL montada aqui no main (não vem do renderer), sempre em api.notion.com.
        openExternal: (url) => shell.openExternal(url)
      })
  }
}

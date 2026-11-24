import { execFile as execFileCb, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir, release as osRelease, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  powerSaveBlocker,
  screen,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { createGitHubClient } from './connectors/github/github.client'
import { GitHubConnector } from './connectors/github/github.connector'
import { readOrkioSiteOrigin } from './connectors/github/orkio-site'
import { createGitHubDeviceApi, readGitHubOAuthConfig } from './connectors/github/github.oauth'
import { createNotionClient } from './connectors/notion/notion.client'
import { NotionConnector, type NotionOAuthDeps } from './connectors/notion/notion.connector'
import {
  NOTION_OAUTH_REDIRECT_URI,
  NOTION_OAUTH_TIMEOUT_MS,
  buildNotionAuthorizeUrl,
  createNotionOAuthBroker,
  readNotionOAuthConfig
} from './connectors/notion/notion.oauth'
import {
  ORKIO_CONFIG_FILE,
  ORKIO_CONFIG_VERSION,
  createOrkioConfigStore,
  type ConfigMigrationNote
} from './config/orkio-config'
import { createGit } from './git/git'
import { notionWorkspaceHandlers } from './ipc/notion-workspace.ipc'
import { projectsHandlers } from './ipc/projects.ipc'
import { signalsHandlers } from './ipc/signals.ipc'
import { createReviewActions } from './signals/review-action'
import { ReviewThreadsService } from './signals/review-threads'
import { boardHandlers } from './ipc/board.ipc'
import { flowHandlers, type FlowFiles } from './ipc/flow.ipc'
import { AutomationService, type AutomationNotification } from './automation/automation.service'
import { AutomationScheduler } from './automation/scheduler'
import { errorName } from './errors'
import { BoardService, type StageChange } from './board/board.service'
import { BoardStore } from './board/board.store'
import { NotionWriteQueue } from './board/write-queue'
import { openDatabase } from './db/database'
import { TaskSignalsService } from './signals/task-signals.service'
import { NotionWorkspaceService } from './notion/notion-workspace.service'
import { authorizeViaLoopback } from './oauth/loopback'
import { ProjectsService } from './projects/projects.service'
import { githubHandlers } from './ipc/github.ipc'
import { OrkioBotService } from './connectors/github/orkio-bot'
import { notionHandlers } from './ipc/notion.ipc'
import { isAllowedExternalUrl, openExternalHandler, siteUrlRules } from './ipc/shell.ipc'
import { createSenderGuard } from './ipc/trusted-sender'
import { registerHandlers, type Handlers } from './ipc/register'
import { createEmitter, type Emit } from './ipc/emit'
import { SecureStore } from './storage/secure-store'
import { ClaudeService, type ClaudeServiceDeps } from './claude/claude.service'
import { detectClaude } from './claude/detect'
import { ArtifactsService, type ArtifactsDeps } from './claude/artifacts.service'
import { ClaudeRun } from './claude/runner'
import {
  FlowError,
  FlowRunner,
  NOOP_ACTION,
  ORKIO_LINES_EXTRACTOR,
  type OrkioAction
} from './flows/flow-runner'
import { FlowsService } from './flows/flows.service'
import type { OpenPrDeps } from './flows/open-pr'
import { AlvaService } from './alva/alva.service'
import { AlvaFlowsService } from './alva/alva-flows.service'
import { runPrecheck } from './alva/precheck'
import { buildCatalog } from './claude/catalog'
import { sanitizeEnv } from './claude/redact'
import { DeliveryService, parseGhAliases } from './delivery/delivery.service'
import { createDeliveryActions } from './delivery/delivery-actions'
import { createPublishReviewAction } from './delivery/review-publish'
import { GitHubReviewPoster } from './connectors/github/review-poster'
import { finalText } from '../shared/review-publish'
import { alvaHandlers } from './ipc/alva.ipc'
import { taskFlowsHandlers } from './ipc/task-flows.ipc'
import { RunService } from './claude/run.service'
import { WorktreeService } from './claude/worktree.service'
import { claudeHandlers } from './ipc/claude.ipc'
import { agentsHandlers } from './ipc/agents.ipc'
import { AgentError, AgentsService } from './agents/agents.service'
import { OrchestratorService } from './orchestrator/orchestrator.service'
import { buildAgentPrompt, commandAllowed } from '../shared/agent'
import { updatesHandlers } from './ipc/updates.ipc'
import { KeepAwake } from './power/keep-awake'
import { onPath, terminalCandidates } from './claude/terminal'
import { collectDiagnostics } from './diagnostics/diagnostics'
import { UpdateService, type UpdaterLike } from './updates/update.service'
import { busyCount, describeBusy } from './updates/busy'
import { isMacAppSigned } from './updates/mac-signature'
import { changelogSection, type AboutInfo } from '../shared/updates'
import { autoUpdater } from 'electron-updater'
import { overviewHandlers } from './ipc/overview.ipc'
import { OverviewService } from './overview/overview.service'
import { applyWaitingBadge, overlayDotBitmap } from './overview/badge'
import appIcon from '../../resources/icon.png?asset'
import changelog from '../../CHANGELOG.md?raw'
import type { AutomationStatus } from '../shared/automation'

const RENDERER_HTML = join(__dirname, '../renderer/index.html')
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

/** Janela inicial: 90% da área útil da tela principal (quase cheia, centralizada). */
function initialWindowSize(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return {
    // Nunca menor que o tamanho antigo (1100×760), nem maior que a tela.
    width: Math.min(width, Math.max(1100, Math.round(width * 0.9))),
    height: Math.min(height, Math.max(760, Math.round(height * 0.9)))
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...initialWindowSize(),
    center: true,
    minWidth: 720,
    minHeight: 520,
    show: false,
    // Mesmo valor de --bg (tokens.css); evita flash branco antes do CSS carregar.
    backgroundColor: '#0A0A0B',
    title: 'Orkio',
    // Linux/Windows usam este ícone na janela/barra de tarefas. No macOS o ícone vem do bundle (.icns).
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Nenhuma janela nova e nenhuma navegação para fora do app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(RENDERER_HTML)
  }
  return win
}

function registerIpc(): void {
  const isTrustedSender = createSenderGuard({
    devServerUrl: DEV_SERVER_URL,
    rendererFileUrl: pathToFileURL(RENDERER_HTML).href
  })
  // Eventos main → renderer (`IPC_EVENTS`): um envio só, com os efeitos declarados no evento.
  const emit = createEmitter({
    windows: () => BrowserWindow.getAllWindows(),
    effects: {
      overview: () => overview?.touch(),
      keepAwake: () => keepAwake?.evaluate()
    }
  })

  const store = new SecureStore(join(app.getPath('userData'), 'secrets'), safeStorage)
  const notion = new NotionConnector({
    store,
    client: createNotionClient(),
    oauth: createNotionOAuthDeps()
  })

  const githubConfig = readGitHubOAuthConfig(import.meta.env)
  const github = new GitHubConnector({
    store,
    client: createGitHubClient(),
    // Device Flow não usa client secret nem o intermediário (broker/).
    device: githubConfig ? createGitHubDeviceApi(githubConfig) : null,
    oauthClientId: githubConfig?.clientId ?? null,
    // Revisão como orkio[bot]: único destino do token do usuário fora do GitHub, fixado aqui.
    // http://127.0.0.1 só no build de E2E.
    siteOrigin: readOrkioSiteOrigin(import.meta.env),
    allowLoopbackSite: import.meta.env.MODE === 'e2e'
  })

  // Uma instância só: Projetos e bancos do Notion escrevem no mesmo arquivo.
  // Migrações que mudam fluxos (v11 → v12) avisam aqui; o histórico vai ao banco quando ele abrir.
  const migrationNotes: ConfigMigrationNote[] = []
  const configStore = createOrkioConfigStore(join(app.getPath('userData'), ORKIO_CONFIG_FILE), {
    onMigrationNote: (note) => migrationNotes.push(note)
  })
  projects = new ProjectsService({
    store: configStore,
    git: createGit(),
    // O token fica no conector; o serviço só pede dados do repositório.
    github: {
      isConnected: () => github.isConnected(),
      getRepository: (owner, name) => github.getRepository(owner, name),
      accessSettingsUrl: () => github.accessSettingsUrl()
    },
    pickFolder: async (purpose) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options: Electron.OpenDialogOptions = {
        title: purpose === 'add' ? 'Escolha a pasta do projeto' : 'Escolha a nova pasta do projeto',
        buttonLabel: 'Usar esta pasta',
        properties: ['openDirectory']
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    folderExists: async (path) => (await stat(path)).isDirectory(),
    realpath: (path) => realpath(path),
    // Evento main → renderer: só id do projeto e branch atual.
    onBranchChanged: (event) => {
      emit('branchChanged', event)
      // Troca/criação de branch com checkout entra na hora nas automações (3B).
      scheduler?.onLocalChange(event.projectId)
    }
  })
  const projectsReady = projects.init()

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

  // Depois de autorizar no navegador, traz o Orkio de volta para a frente.
  const focusSender = (event: IpcMainInvokeEvent): void => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }

  const orkioBot = new OrkioBotService({
    isConnected: () => github.isConnected(),
    listProjects: async () => (await projects?.list())?.projects ?? [],
    installation: (owner, repo) => github.orkioBotInstallation(owner, repo)
  })

  const signals = new TaskSignalsService({
    store: configStore,
    git: createGit(),
    // O token fica no conector; o serviço só faz leituras de repositório.
    github: {
      isConnected: () => github.isConnected(),
      accessSettingsUrl: () => github.accessSettingsUrl(),
      getConditional: (path, etag) => github.getConditional(path, etag),
      graphql: (query, variables) => github.graphql(query, variables)
    },
    listTasks: (projectId) => notionWorkspace.listTasks(projectId),
    // Branches registradas para cada tarefa (banco sem ID no Notion); o worktree nasce depois.
    linkedBranches: (projectId) => worktreesForSignals?.linkedBranchesByTask(projectId) ?? new Map()
  })
  // Threads da PR da tarefa (Task 15): a PR vem dos sinais em cache; o texto, do GraphQL (repo).
  const reviewThreads = new ReviewThreadsService({
    graphql: (query, variables) => github.graphql(query, variables),
    isConnected: () => github.isConnected(),
    locate: (projectId, taskId) => {
      const repo = configStore.get().projects.find((p) => p.id === projectId)?.repo
      if (!repo || repo.host.toLowerCase() !== 'github.com') return null
      const pr = signals.cached(projectId)?.signals[taskId]?.pr ?? null
      return {
        owner: repo.owner,
        repo: repo.name,
        pr: pr ? { number: pr.number, url: pr.url } : null
      }
    },
    refresh: async (projectId) => void (await signals.get(projectId))
  })

  // Grupos que dependem do banco local; `null` = banco indisponível (cada canal responde o fallback).
  let dbHandlers: Pick<
    Handlers,
    'board' | 'flow' | 'automation' | 'alva' | 'agents' | 'taskFlows' | 'claude' | 'overview'
  > = {
    board: null,
    flow: null,
    automation: null,
    alva: null,
    agents: null,
    taskFlows: null,
    claude: null,
    overview: null
  }

  // Quadro (3A): SQLite local + fila de escrita persistente no Notion.
  const boardStore = openBoardStore()
  if (boardStore) {
    // Histórico de configuração das migrações (ex.: fluxos Alva atualizados na v12).
    void projectsReady.then(() => {
      const at = new Date().toISOString()
      for (const note of migrationNotes.splice(0)) {
        try {
          boardStore.addConfigEvent(note.projectId, at, 'Orkio (atualização)', note.changes)
        } catch (error) {
          console.error(`[orkio] histórico da migração: ${errorName(error)}`)
        }
      }
    })
    // Agentes (8A): perfis em arquivos, aprovação, atribuição e limites (nenhuma permissão nova).
    const agents = new AgentsService({
      db: boardStore.db,
      store: boardStore,
      config: configStore,
      localDir: join(app.getPath('userData'), 'agents'),
      hasActiveFlow: (taskId) => flowRunner?.hasActive(taskId) ?? false,
      stageIds: (projectId) => configStore.get().boards[projectId]?.stages.map((s) => s.id) ?? [],
      actor: () => userInfo().username,
      emit: (projectId) => emit('agentsChanged', { projectId })
    })
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
      onSync: (event) => emit('boardSync', event),
      actor: () => userInfo().username,
      // 8B: etapa de trabalho do orquestrador dá um agente dela (antes da regra da coluna).
      // 8A: a regra da coluna atribui o agente (na mesma transação) antes de o fluxo começar.
      // 5A: entrada/saída de etapa vai para os fluxos (o runner adia o trabalho).
      onStageChanged: (change) => {
        orchestrator?.onStageChanged(change)
        agents.onStageChanged(change)
        flowRunner?.onStageChanged(change)
      }
    })
    writeQueue = new NotionWriteQueue({
      store: boardStore,
      // O token fica no conector.
      updatePage: (pageId, properties) => notion.updatePage(pageId, properties),
      onSynced: (w) => board.onSynced(w),
      onRejected: (w, e) => void board.onRejected(w, e),
      onRetry: (w, e) => board.onRetry(w, e)
    })
    board.attachQueue(writeQueue)
    const flowFiles: FlowFiles = {
      save: async (json) => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const options: Electron.SaveDialogOptions = {
          title: 'Exportar fluxo do projeto',
          defaultPath: 'fluxo-orkio.json',
          filters: [{ name: 'Fluxo do Orkio', extensions: ['json'] }]
        }
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return null
        await writeFile(result.filePath, json, 'utf8')
        return true
      },
      open: async (maxBytes) => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const options: Electron.OpenDialogOptions = {
          title: 'Importar fluxo do projeto',
          properties: ['openFile'],
          filters: [{ name: 'Fluxo do Orkio', extensions: ['json'] }]
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        const file = result.canceled ? undefined : result.filePaths[0]
        if (!file) return null
        if ((await stat(file)).size > maxBytes) throw new Error('arquivo grande demais')
        return readFile(file, 'utf8')
      }
    }

    // Automações (3B): motor + agendador em segundo plano.
    const automation = new AutomationService({
      config: configStore,
      store: boardStore,
      board,
      signals,
      notify: (n) => showNotification(n, emit),
      onChanged: (projectId) => emit('boardChanged', { projectId })
    })
    const git = createGit()
    const automationProjects = (): string[] => {
      const c = configStore.get()
      return c.projects.filter((p) => p.notionProject && c.boards[p.id]).map((p) => p.id)
    }
    scheduler = new AutomationScheduler({
      // 8B: depois de cada ciclo das automações, uma rodada do orquestrador (se ligado).
      run: async (projectId, options) => {
        const result = await automation.run(projectId, options)
        await orchestrator?.tick(projectId).catch(() => undefined)
        return result
      },
      projects: automationProjects,
      localBranches: async (projectId) => {
        const project = configStore.get().projects.find((p) => p.id === projectId)
        return project ? git.localBranches(project.localPath) : null
      }
    })
    const automationStatus = (projectId: string): AutomationStatus => {
      const s = scheduler!.getStatus(projectId)
      return {
        paused: configStore.get().automation.paused,
        github: s.github,
        lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
        nextRunAt: s.nextRunAt ? new Date(s.nextRunAt).toISOString() : null,
        error: s.error || null
      }
    }
    const automationImpl: Handlers['automation'] = {
      status: (projectId) => automationStatus(projectId),
      runNow: async (projectId) => {
        await scheduler!.runNow(projectId)
        return automationStatus(projectId)
      },
      setPaused: async (paused) => {
        await configStore.update((c) => ({ ...c, automation: { paused } }))
        return automationStatus('')
      }
    }

    // Claude Code (4A): CLI do usuário (assinatura dele), worktree por tarefa, permissões pelo Orkio.
    const claude = createClaude({
      boardStore,
      git,
      configStore,
      listTasks: (projectId) => notionWorkspace.listTasks(projectId),
      signals: (projectId) => signals.get(projectId),
      prFor: (projectId, branch) => signals.prForBranch(projectId, branch)?.number ?? null,
      getBlockChildren: (id, cursor) => notion.getBlockChildren(id, cursor),
      notionInsert: {
        createChildPage: (parent, title, markdown) =>
          notion.createChildPage(parent, title, markdown),
        appendMarkdown: (pageId, markdown) => notion.appendMarkdown(pageId, markdown)
      },
      // 8A: "Rodar como <agente>" (instruções e modelo; mesmas permissões).
      agentFor: async (projectId, taskId, command) => {
        const runtime = await agents.runtimeFor(projectId, taskId)
        if (!runtime) return null
        const limit = agents.limitProblem(runtime)
        if (limit) throw new AgentError('limit', limit)
        if (command && !commandAllowed(runtime.profile, command)) {
          throw new AgentError(
            'denied',
            `${runtime.profile.name} não tem permissão para o comando /${command}.`
          )
        }
        return {
          key: runtime.key,
          name: runtime.profile.name,
          prompt: buildAgentPrompt(runtime.profile),
          model: runtime.profile.model === 'default' ? null : runtime.profile.model,
          effort: runtime.profile.effort
        }
      },
      agentInfo: async (projectId, taskId) => {
        const key = agents.assignedKey(taskId)
        if (!key) return null
        const view = await agents.get(projectId, key)
        if (!view?.profile) return { name: key, problem: 'O agente desta tarefa não existe mais.' }
        try {
          const runtime = await agents.runtimeFor(projectId, taskId)
          return { name: view.profile.name, problem: runtime ? agents.limitProblem(runtime) : null }
        } catch (error) {
          return {
            name: view.profile.name,
            problem: error instanceof AgentError ? error.message : 'Agente indisponível.'
          }
        }
      },
      emit
    })
    claudeRuns = claude.runs
    worktreesForSignals = claude.worktrees

    // Fluxos de tarefa (5A): passos ligados às colunas, sobre as execuções da 4A.
    const flows = createFlowRunner({
      boardStore,
      configStore,
      board,
      claude: claude.service,
      runs: claude.runs,
      worktrees: claude.worktrees,
      delivery: claude.delivery,
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
        store: boardStore,
        runAutomation: (projectId) => void scheduler?.runNow(projectId).catch(() => undefined)
      }).concat(
        // Revisão (Task 15): o Orkio lê as threads da PR e grava .orkio/revisao.md no worktree.
        createReviewActions({
          reviews: reviewThreads,
          ensureWorktree: (projectId, taskId) =>
            claude.service.ensureWorktreePath(projectId, taskId)
        }),
        // Task 18: revisão do agente publicada na PR como orkio[bot] (pelo site, depois do gate).
        createPublishReviewAction({
          poster: new GitHubReviewPoster({ github }),
          finalText: async (runId) => finalText(await claude.runs.readLog(runId)),
          signals: (projectId, force) => signals.get(projectId, { force }),
          repo: (projectId) => {
            const repo = configStore.get().projects.find((p) => p.id === projectId)?.repo
            return repo && repo.host.toLowerCase() === 'github.com'
              ? { owner: repo.owner, repo: repo.name }
              : null
          },
          store: boardStore,
          runAutomation: (projectId) => void scheduler?.runNow(projectId).catch(() => undefined)
        })
      ),
      emit,
      onFlowFinished: (projectId) => orchestrator?.runSoon(projectId),
      // Mesma ordem da entrada pelo quadro (orquestrador → regra da coluna → fluxo da coluna).
      stageEntered: (change) => {
        orchestrator?.onStageChanged(change)
        agents.onStageChanged(change)
        flowRunner?.onStageChanged(change)
      }
    })
    flowRunner = flows.runner
    const runner = flowRunner
    orchestrator = new OrchestratorService({
      config: configStore,
      db: boardStore.db,
      store: boardStore,
      board,
      agents,
      flows: {
        hasActive: (taskId) => runner.hasActive(taskId),
        startManual: (projectId, taskId) => runner.startManual(projectId, taskId)
      },
      actor: () => userInfo().username,
      emit: (projectId) => {
        emit('agentsChanged', { projectId })
        emit('boardChanged', { projectId })
      }
    })

    // Visão geral (6D): agrega o que já está no app; nunca chama APIs sozinha.
    overview = new OverviewService({
      db: boardStore.db,
      config: () => configStore.get(),
      projects: async () => (await projects!.list()).projects,
      flows: () => flowRunner?.activeViews() ?? [],
      requests: () => claude.runs.waitingRequests(),
      runs: () => claude.runs.activeRuns(),
      cachedTasks: (projectId) => notionWorkspace.cachedTasks(projectId),
      notionHealth: () => notionWorkspace.cachedHealth(),
      signals: (projectId) => signals.cached(projectId)?.signals ?? null,
      pulls: (projectId) => signals.cachedPulls(projectId),
      refresh: async (projectId) => {
        await scheduler?.runNow(projectId)
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
    dbHandlers = {
      board: boardHandlers(board),
      flow: flowHandlers(board, flowFiles),
      automation: automationImpl,
      alva: flows.handlers.alva,
      agents: agentsHandlers(agents, orchestrator),
      taskFlows: flows.handlers.taskFlows,
      claude: claude.handlers,
      overview: overviewHandlers(overview)
    }

    void projectsReady.then(async () => {
      // Total inicial de "Esperando você" (badge do ícone e menu lateral).
      overview?.touch()
      // Retoma o que ficou pendente quando o app fechou.
      writeQueue?.start()
      // Liga os HeadWatchers (eventos locais na hora) e começa os ciclos.
      await projects?.list().catch(() => undefined)
      scheduler?.start()
    })
  }
  const siteUrl = readSiteUrl()

  // Atualizações automáticas (6C). Funcionam mesmo com a config em modo só leitura ou sem o banco
  // local: é assim que se sai de um downgrade.
  updates = createUpdates({
    configStore,
    ready: projectsReady,
    emit,
    taskLabel: async (projectId, taskId) => {
      const r = await notionWorkspace.listTasks(projectId)
      return r.ok ? (r.value.tasks.find((t) => t.id === taskId)?.displayId ?? null) : null
    }
  })
  // Diagnóstico (Sobre): só versões, contagens e estados, sem rede e sem segredos.
  const diagnostics = (): Promise<string> =>
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
      connections: async () => [
        { name: 'Notion', status: await notion.getStatus() },
        { name: 'GitHub', status: await github.getStatus() }
      ],
      toolVersion: (cmd) =>
        new Promise((resolve) => {
          execFileCb(
            cmd,
            ['--version'],
            { env: sanitizeEnv(toolEnv()), timeout: 5_000, windowsHide: true },
            (error, stdout) =>
              resolve(error ? null : (String(stdout).split('\n')[0]?.trim() ?? null) || null)
          )
        }),
      countEntries: async (what) => {
        const root = join(app.getPath('userData'), what)
        try {
          if (what === 'runs') return (await readdir(root)).length
          let n = 0
          for (const project of await readdir(root)) {
            n += (await readdir(join(root, project)).catch(() => [])).length
          }
          return n
        } catch {
          return 0
        }
      },
      projects: () => {
        const c = configStore.get()
        return {
          total: c.projects.length,
          withBoard: c.projects.filter((p) => c.boards[p.id]).length
        }
      },
      automation: () => {
        const c = configStore.get()
        const ids = c.projects.filter((p) => p.notionProject && c.boards[p.id]).map((p) => p.id)
        return {
          polling: scheduler ? ids.length : 0,
          failing: scheduler ? ids.filter((id) => scheduler!.getStatus(id).failures > 0).length : 0
        }
      }
    })
  void projectsReady.then(() => updates?.start())

  // Manter o computador acordado enquanto agentes trabalham (opção, desligada por padrão).
  keepAwake = new KeepAwake({
    blocker: powerSaveBlocker,
    enabled: () => configStore.get().keepAwake === true,
    busy: () =>
      (claudeRuns?.activeList().some((r) => !r.queued) ?? false) ||
      (flowRunner?.runningList().length ?? 0) > 0
  })
  keepAwake.start()

  registerHandlers(
    ipcMain,
    { isTrustedSender, ready: projectsReady },
    {
      notion: notionHandlers(notion, focusSender),
      github: githubHandlers(github, {
        onDeviceFlowFinished: focusSender,
        orkioBot: (force) => orkioBot.status(force)
      }),
      projects: projectsHandlers(projects),
      notionWorkspace: notionWorkspaceHandlers(notionWorkspace),
      signals: signalsHandlers(signals, reviewThreads),
      ...dbHandlers,
      updates: updatesHandlers(
        updates,
        () => ({ version: app.getVersion(), links: siteLinks(siteUrl) }),
        diagnostics
      ),
      power: {
        keepAwake: () => configStore.get().keepAwake === true,
        setKeepAwake: async (enabled) => {
          await projectsReady
          if (configStore.readOnly) return configStore.get().keepAwake === true
          await configStore.update((c) => {
            const next = { ...c }
            if (enabled) next.keepAwake = true
            else delete next.keepAwake
            return next
          })
          keepAwake?.evaluate()
          return configStore.get().keepAwake === true
        }
      },
      openExternal: openExternalHandler((url) => shell.openExternal(url), siteUrlRules(siteUrl))
    }
  )
}

/** Endereço do site (Sobre): `MAIN_VITE_SITE_URL` ou a origem do intermediário OAuth (é o site). */
function readSiteUrl(): string | null {
  const raw =
    import.meta.env.MAIN_VITE_SITE_URL || import.meta.env.MAIN_VITE_NOTION_OAUTH_BROKER_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.port ? url.origin : null
  } catch {
    return null
  }
}

function siteLinks(siteUrl: string | null): AboutInfo['links'] {
  return siteUrl
    ? { site: siteUrl, privacy: `${siteUrl}/privacidade`, terms: `${siteUrl}/termos` }
    : null
}

/** Mesmo desligamento do fechamento normal, esperando as execuções saírem (até 12 s). */
async function shutdownWork(): Promise<void> {
  flowRunner?.dispose()
  claudeRuns?.cancelAll()
  const deadline = Date.now() + 12_000
  while ((claudeRuns?.activeList().some((r) => !r.queued) ?? false) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  writeQueue?.stop()
  scheduler?.stop()
}

function createUpdates(deps: {
  configStore: ReturnType<typeof createOrkioConfigStore>
  ready: Promise<void>
  emit: Emit
  taskLabel: (projectId: string, taskId: string) => Promise<string | null>
}): UpdateService {
  const busyInput = (): Omit<Parameters<typeof describeBusy>[0], 'taskLabel'> => ({
    runs: claudeRuns?.activeList() ?? [],
    flows: flowRunner?.runningList() ?? [],
    pendingWrites: writeQueue?.pendingCount() ?? 0
  })
  const version = app.getVersion()
  return new UpdateService({
    // O tipo do electron-updater é um emissor tipado; usamos só o pedaço descrito em UpdaterLike.
    updater: autoUpdater as unknown as UpdaterLike,
    currentVersion: version,
    isPackaged: () => app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    isAppImage: process.platform === 'linux' && !!process.env['APPIMAGE'],
    macSigned: () =>
      isMacAppSigned(
        (command, args) =>
          new Promise((resolve, reject) => {
            execFileCb(
              command,
              args,
              { timeout: 10_000, windowsHide: true },
              (error, _out, stderr) => {
                if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(error)
                else
                  resolve({
                    code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
                    stderr: String(stderr)
                  })
              }
            )
          }),
        app.getPath('exe'),
        import.meta.env.MAIN_VITE_MAC_SIGNED === '1'
      ),
    settings: {
      get: () => deps.configStore.get().updates,
      save: async (patch) => {
        await deps.ready
        await deps.configStore.update((c) => ({ ...c, updates: { ...c.updates, ...patch } }))
      },
      writable: () => !deps.configStore.readOnly
    },
    busyCount: () => busyCount(busyInput()),
    busyItems: () => describeBusy({ ...busyInput(), taskLabel: deps.taskLabel }),
    shutdownWork,
    openExternal: async (url) => {
      // Mesma allowlist do renderer: só o repo público de releases.
      if (isAllowedExternalUrl(url)) await shell.openExternal(url)
    },
    releaseNotes: () => {
      const notes = changelogSection(changelog, version)
      return notes === null ? null : { version, notes }
    },
    emit: (status) => deps.emit('updateStatus', status),
    askRestart: async (next) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      const options: Electron.MessageBoxOptions = {
        type: 'info',
        title: 'Atualização pronta',
        message: `O Orkio ${next} foi baixado.`,
        detail: 'Reiniciar agora para atualizar? O Orkio fecha e abre de novo na versão nova.',
        buttons: ['Reiniciar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      }
      const { response } = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      return response === 0
    }
  })
}

let projects: ProjectsService | null = null
let writeQueue: NotionWriteQueue | null = null
let scheduler: AutomationScheduler | null = null
let claudeRuns: RunService | null = null
/** Registro de branches por tarefa (lido pelos sinais; criado junto com o Claude Code). */
let worktreesForSignals: WorktreeService | null = null
let flowRunner: FlowRunner | null = null
/** Orquestrador (8B): dá a tarefa ao agente da etapa e passa adiante quando o fluxo termina. */
let orchestrator: OrchestratorService | null = null
let updates: UpdateService | null = null
let keepAwake: KeepAwake | null = null
let overview: OverviewService | null = null

function createFlowRunner(deps: {
  boardStore: BoardStore
  configStore: ReturnType<typeof createOrkioConfigStore>
  board: BoardService
  claude: ClaudeService
  runs: RunService
  worktrees: WorktreeService
  delivery: DeliveryService
  agents: AgentsService
  listTasks: ClaudeServiceDeps['listTasks']
  deliveryActions: OrkioAction[]
  emit: Emit
  onFlowFinished: (projectId: string) => void
  stageEntered: (change: StageChange) => void
}): { runner: FlowRunner; handlers: Pick<Handlers, 'alva' | 'taskFlows'> } {
  // alva-flow (5B): vínculo com o Backlog.md, extrator, pré-checagem e ações pendentes da 5C.
  const env = toolEnv()
  const neutralDir = join(app.getPath('userData'), 'alva-check')
  void mkdir(neutralDir, { recursive: true }).catch(() => undefined)
  const projectDir = (projectId: string): string | null =>
    deps.configStore.get().projects.find((p) => p.id === projectId)?.localPath ?? null
  const alva = new AlvaService({
    db: deps.boardStore.db,
    worktreePath: (taskId) => deps.worktrees.get(taskId)?.path ?? null,
    projectDir,
    taskInfo: async (projectId, taskId) => {
      const r = await deps.listTasks(projectId)
      const t = r.ok ? r.value.tasks.find((x) => x.id === taskId) : undefined
      return t?.displayId ? { displayId: t.displayId, title: t.title, url: t.url } : null
    }
  })
  const alvaFlows = new AlvaFlowsService({
    config: deps.configStore,
    store: deps.boardStore,
    board: deps.board,
    alva,
    actor: () => userInfo().username,
    precheck: async (dir) => {
      const catalog = await buildCatalog({ projectDir: dir, home: homedir() })
      return runPrecheck(
        dir,
        catalog.flatMap((g) => g.commands.map((c) => c.name)),
        {
          neutralDir,
          exec: (command, args, options) =>
            new Promise((resolve, reject) => {
              execFileCb(
                command,
                args,
                {
                  cwd: options.cwd,
                  timeout: options.timeoutMs,
                  env: sanitizeEnv(env),
                  windowsHide: true,
                  maxBuffer: 1024 * 1024
                },
                (error, stdout) => {
                  // Comando ausente → rejeita; código ≠ 0 → resolve com o código (só ele importa).
                  if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(error)
                  else
                    resolve({
                      code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
                      stdout: String(stdout)
                    })
                }
              )
            })
        }
      )
    }
  })

  const extractors = [ORKIO_LINES_EXTRACTOR, alva.extractor]
  const actions = [NOOP_ACTION, ...deps.deliveryActions]
  const runner = new FlowRunner({
    db: deps.boardStore.db,
    store: deps.boardStore,
    flows: (projectId) => deps.configStore.get().flows[projectId] ?? { flows: [], bindings: [] },
    currentStage: (_projectId, taskId) =>
      deps.boardStore.db.get<{ stage_id: string | null }>(
        'SELECT stage_id FROM task_state WHERE task_page_id = ?',
        taskId
      )?.stage_id ?? null,
    prepare: async (projectId, taskId) => {
      const r = await deps.claude.flowContext(projectId, taskId)
      if (!r.ok) throw new FlowError(r.error.code, r.error.message)
      return r.value
    },
    startClaude: async (input) => {
      const r = await deps.claude.startForFlow(input)
      if (!r.ok) throw new FlowError(r.error.code, r.error.message)
      return r.value
    },
    cancelClaude: (runId) => deps.claude.cancel(runId),
    extractors,
    actions,
    worktreePath: (taskId) => deps.worktrees.get(taskId)?.path ?? null,
    initialVars: (projectId, taskId, flow) =>
      flow.tags?.includes('alva') ? alva.initialVars(projectId, taskId) : Promise.resolve({}),
    canStart: (projectId, flow) => alvaFlows.blockReason(projectId, flow),
    agentFor: async (projectId, taskId) => {
      try {
        return await deps.agents.runtimeFor(projectId, taskId)
      } catch (error) {
        if (error instanceof AgentError) throw new FlowError(error.code, error.message)
        throw error
      }
    },
    agentLimit: (agent) => deps.agents.limitProblem(agent),
    concurrencyLimit: (projectId, flow) => alvaFlows.concurrencyLimit(projectId, flow),
    notify: (title, body, ref) =>
      showNotification({ title, body, projectId: ref.projectId, taskId: ref.taskId }, deps.emit),
    emit: (ref) => deps.emit('taskFlowChanged', ref),
    onFinished: (ref) => deps.onFlowFinished(ref.projectId),
    stageEntered: (change) => deps.stageEntered(change)
  })
  deps.runs.onFinished((info) => runner.onRunFinished(info))
  runner.init()
  const service = new FlowsService({
    config: deps.configStore,
    store: deps.boardStore,
    runner,
    extractors,
    actions,
    actor: () => userInfo().username
  })
  const openPrDeps: OpenPrDeps = {
    linked: (taskId) => alva.getLink(taskId) !== null,
    blockReason: (projectId, flow) => alvaFlows.blockReason(projectId, flow),
    compareUrl: (projectId, taskId) => deps.delivery.compareUrl(projectId, taskId),
    alreadyPushed: (projectId, taskId) => deps.delivery.alreadyPushed(projectId, taskId),
    startBuiltin: (projectId, taskId, flow) => runner.startBuiltin(projectId, taskId, flow)
  }
  return {
    runner,
    handlers: {
      alva: alvaHandlers(alvaFlows),
      taskFlows: taskFlowsHandlers(service, runner, openPrDeps)
    }
  }
}

/**
 * Apps abertos pelo Finder/menu não herdam o PATH do terminal: acrescenta as pastas usuais do
 * Claude Code e dos editores (instalador nativo, npm global, Homebrew).
 */
function toolEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extra = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]
  const current = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  const path = [...current, ...extra.filter((d) => !current.includes(d))].join(delimiter)
  return { ...process.env, PATH: path }
}

/** Abre o terminal do sistema na pasta (spawn sem shell; o primeiro terminal achado no PATH). */
async function openTerminalAt(dir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const isFile = (p: string): boolean => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('no_workspace')
  }
  const candidate = terminalCandidates(process.platform, env, dir).find((c) =>
    process.platform === 'darwin' ? true : onPath(c.cmd, env, process.platform, isFile)
  )
  if (!candidate) throw new Error('no_terminal')
  await new Promise<void>((resolve, reject) => {
    // Terminais sem argumento de pasta ($TERMINAL, x-terminal-emulator) abrem no cwd.
    const child = spawn(candidate.cmd, candidate.args, {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
      env
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function createClaude(deps: {
  boardStore: BoardStore
  git: ReturnType<typeof createGit>
  configStore: ReturnType<typeof createOrkioConfigStore>
  listTasks: ClaudeServiceDeps['listTasks']
  signals: ClaudeServiceDeps['signals']
  prFor: (projectId: string, branch: string) => number | null
  getBlockChildren: ClaudeServiceDeps['getBlockChildren']
  agentFor: NonNullable<ClaudeServiceDeps['agentFor']>
  agentInfo: NonNullable<ClaudeServiceDeps['agentInfo']>
  /** Escritas no Notion para publicar artefatos (o token fica no conector). */
  notionInsert: ArtifactsDeps['notion']
  emit: Emit
}): {
  handlers: Handlers['claude']
  runs: RunService
  service: ClaudeService
  worktrees: WorktreeService
  delivery: DeliveryService
} {
  const userData = app.getPath('userData')
  const tmpDir = join(userData, 'run-tmp')
  const env = toolEnv()
  const worktrees = new WorktreeService({
    git: deps.git,
    db: deps.boardStore.db,
    root: join(userData, 'worktrees')
  })
  const delivery = new DeliveryService({
    git: deps.git,
    project: (id) => deps.configStore.get().projects.find((p) => p.id === id) ?? null,
    worktree: (taskId) => worktrees.get(taskId),
    settings: (projectId) => deps.configStore.get().delivery[projectId]
  })
  let service: ClaudeService | null = null
  const runs = new RunService({
    db: deps.boardStore.db,
    store: deps.boardStore,
    worktrees,
    git: deps.git,
    runsDir: join(userData, 'runs'),
    createRun: (options) =>
      new ClaudeRun({
        ...options,
        claudeCommand: 'claude',
        // O servidor MCP de permissões roda no Node do próprio Electron.
        nodePath: process.execPath,
        bridgeScript: join(__dirname, 'permission-mcp.js'),
        tmpDir,
        env
      }),
    // Aliases do git/gh e push.default: a política resolve `git p`/`gh m` antes de decidir.
    policyInputs: async (dir) => {
      const [gitAliases, pushDefault, ghAliases] = await Promise.all([
        deps.git.aliases(dir).catch(() => ({})),
        deps.git.configValue(dir, 'push.default'),
        new Promise<Record<string, string>>((resolve) => {
          execFileCb(
            'gh',
            ['alias', 'list'],
            { cwd: dir, env: sanitizeEnv(env), timeout: 5_000, windowsHide: true },
            (error, stdout) => resolve(error ? {} : parseGhAliases(String(stdout)))
          )
        })
      ])
      return { aliases: { git: gitAliases, gh: ghAliases }, pushDefault }
    },
    currentBranch: (dir) => deps.git.currentBranch(dir),
    prFor: deps.prFor,
    emit: (message) => {
      service?.onRunEvent(message.event)
      deps.emit('runEvent', message)
    },
    notify: (title, body, ref) =>
      showNotification({ title, body, projectId: ref.projectId, taskId: ref.taskId }, deps.emit)
  })
  service = new ClaudeService({
    deliveryTarget: (projectId, taskId) => {
      const t = delivery.target(projectId, taskId)
      return {
        target: {
          owner: t.owner,
          repo: t.repo,
          remote: t.remote,
          branch: t.branch,
          defaultBranch: t.defaultBranch,
          displayId: t.displayId
        },
        requirePushApproval: delivery.settings(projectId).requirePushApproval
      }
    },
    config: deps.configStore,
    worktrees,
    runs,
    git: deps.git,
    listTasks: deps.listTasks,
    signals: deps.signals,
    getBlockChildren: deps.getBlockChildren,
    detect: () => detectClaude({ env }),
    agentFor: deps.agentFor,
    agentInfo: deps.agentInfo,
    flowActive: (taskId) => flowRunner?.hasActive(taskId) ?? false,
    flowBusy: (taskId) => flowRunner?.isBusy(taskId) ?? false,
    flowMessage: async (taskId, text, note) => {
      try {
        return { used: (await flowRunner?.handleMessage(taskId, text, note)) != null }
      } catch (error) {
        if (error instanceof FlowError) return { error: error.message }
        throw error
      }
    },
    artifacts: new ArtifactsService({
      db: deps.boardStore.db,
      store: deps.boardStore,
      worktrees,
      git: deps.git,
      notion: deps.notionInsert
    }),
    openTerminal: (path) => openTerminalAt(path, env),
    openEditor: (editor, path) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(editor, [path], {
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: true,
          env
        })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
  })
  void mkdir(tmpDir, { recursive: true, mode: 0o700 }).catch(() => undefined)
  return { handlers: claudeHandlers(service), runs, service, worktrees, delivery }
}

/** Notificação de desktop (opcional por regra). Clique: foca o Orkio e abre a tarefa. */
function showNotification(n: AutomationNotification, emit: Emit): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: n.title, body: n.body, silent: false })
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
function openBoardStore(): BoardStore | null {
  try {
    return new BoardStore(openDatabase(join(app.getPath('userData'), 'orkio.db')))
  } catch (error) {
    console.error(`[orkio] banco local indisponível: ${errorName(error)}`)
    return null
  }
}

/** OAuth do Notion só existe se o build tiver client ID e URL do intermediário. */
function createNotionOAuthDeps(): NotionOAuthDeps | null {
  const config = readNotionOAuthConfig(import.meta.env)
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

// Em dev no Linux não há .desktop instalado: o GNOME (Wayland) mostra uma engrenagem na doca. O
// `predev` cria ~/.local/share/applications/orkio-dev.desktop com o ícone; aqui a janela se
// identifica com ele (app_id/WM_CLASS). Empacotado, o .desktop vem do instalador.
if (process.platform === 'linux' && !app.isPackaged) app.setDesktopName('orkio-dev.desktop')

void app.whenReady().then(() => {
  // Nenhuma permissão do navegador (câmera, notificações etc.), exceto ESCREVER na área de
  // transferência (botão "Copiar" do código do GitHub). Ler a área de transferência continua negado.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write')
  )

  // Em dev no macOS não há bundle .app: aplicamos o ícone no Dock manualmente.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(appIcon)

  registerIpc()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  keepAwake?.dispose()
  updates?.stop()
  overview?.dispose()
  flowRunner?.dispose()
  claudeRuns?.cancelAll()
  projects?.dispose()
  writeQueue?.stop()
  scheduler?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

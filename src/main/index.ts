import { execFile as execFileCb, spawn } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { createGitHubClient } from './connectors/github/github.client'
import { GitHubConnector } from './connectors/github/github.connector'
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
import { ORKIO_CONFIG_FILE, createOrkioConfigStore } from './config/orkio-config'
import { createGit } from './git/git'
import { registerNotionWorkspaceIpc } from './ipc/notion-workspace.ipc'
import { registerProjectsIpc } from './ipc/projects.ipc'
import { registerSignalsIpc } from './ipc/signals.ipc'
import { registerBoardIpc } from './ipc/board.ipc'
import { registerFlowIpc } from './ipc/flow.ipc'
import { registerAutomationIpc } from './ipc/automation.ipc'
import { AutomationService, type AutomationNotification } from './automation/automation.service'
import { AutomationScheduler } from './automation/scheduler'
import { errorName } from './ipc/payload'
import { BoardService } from './board/board.service'
import { BoardStore } from './board/board.store'
import { NotionWriteQueue } from './board/write-queue'
import { openDatabase } from './db/database'
import { TaskSignalsService } from './signals/task-signals.service'
import { NotionWorkspaceService } from './notion/notion-workspace.service'
import { authorizeViaLoopback } from './oauth/loopback'
import { ProjectsService } from './projects/projects.service'
import { registerGitHubIpc } from './ipc/github.ipc'
import { registerNotionIpc } from './ipc/notion.ipc'
import { registerShellIpc } from './ipc/shell.ipc'
import { createSenderGuard } from './ipc/trusted-sender'
import { IPC_CHANNELS, type AutomationStatus, type BoardSyncEvent } from '../shared/ipc-contract'
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
import { AlvaService } from './alva/alva.service'
import { AlvaFlowsService } from './alva/alva-flows.service'
import { runPrecheck } from './alva/precheck'
import { buildCatalog } from './claude/catalog'
import { sanitizeEnv } from './claude/redact'
import { DeliveryService, parseGhAliases } from './delivery/delivery.service'
import { createDeliveryActions } from './delivery/delivery-actions'
import { registerAlvaIpc } from './ipc/alva.ipc'
import { registerTaskFlowsIpc } from './ipc/task-flows.ipc'
import { RunService } from './claude/run.service'
import { WorktreeService } from './claude/worktree.service'
import { registerClaudeIpc } from './ipc/claude.ipc'
import appIcon from '../../resources/icon.png?asset'

const RENDERER_HTML = join(__dirname, '../renderer/index.html')
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
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
    oauthClientId: githubConfig?.clientId ?? null
  })

  // Uma instância só: Projetos e bancos do Notion escrevem no mesmo arquivo.
  const configStore = createOrkioConfigStore(join(app.getPath('userData'), ORKIO_CONFIG_FILE))
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
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.projects.branchChanged, event)
      }
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
      queryDataSource: (id, options) => notion.queryDataSource(id, options)
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

  registerNotionIpc(ipcMain, notion, isTrustedSender, { onOAuthFinished: focusSender })
  registerGitHubIpc(ipcMain, github, isTrustedSender, { onDeviceFlowFinished: focusSender })
  registerProjectsIpc(ipcMain, projects, isTrustedSender, projectsReady)
  registerNotionWorkspaceIpc(ipcMain, notionWorkspace, isTrustedSender, projectsReady)

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
    listTasks: (projectId) => notionWorkspace.listTasks(projectId)
  })
  registerSignalsIpc(ipcMain, signals, isTrustedSender, projectsReady)

  // Quadro (3A): SQLite local + fila de escrita persistente no Notion.
  const boardStore = openBoardStore()
  if (boardStore) {
    const broadcast = (event: BoardSyncEvent): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.board.syncChanged, event)
      }
    }
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
      onSync: broadcast,
      actor: () => userInfo().username,
      // 5A: entrada/saída de etapa vai para os fluxos (o runner adia o trabalho).
      onStageChanged: (change) => flowRunner?.onStageChanged(change)
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
    registerBoardIpc(ipcMain, board, isTrustedSender, projectsReady)
    registerFlowIpc(
      ipcMain,
      board,
      {
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
      },
      isTrustedSender,
      projectsReady
    )

    // Automações (3B): motor + agendador em segundo plano.
    const send = (channel: string, payload: unknown): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload)
      }
    }
    const automation = new AutomationService({
      config: configStore,
      store: boardStore,
      board,
      signals,
      notify: (n) => showNotification(n, send),
      onChanged: (projectId) => send(IPC_CHANNELS.board.changed, { projectId })
    })
    const git = createGit()
    const automationProjects = (): string[] => {
      const c = configStore.get()
      return c.projects.filter((p) => p.notionProject && c.boards[p.id]).map((p) => p.id)
    }
    scheduler = new AutomationScheduler({
      run: (projectId, options) => automation.run(projectId, options),
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
    registerAutomationIpc(
      ipcMain,
      {
        status: automationStatus,
        runNow: async (projectId) => {
          await scheduler!.runNow(projectId)
          return automationStatus(projectId)
        },
        setPaused: async (paused) => {
          await configStore.update((c) => ({ ...c, automation: { paused } }))
          return automationStatus('')
        }
      },
      isTrustedSender,
      projectsReady
    )

    // Claude Code (4A): CLI do usuário (assinatura dele), worktree por tarefa, permissões pelo Orkio.
    const claude = createClaude({
      boardStore,
      git,
      configStore,
      listTasks: (projectId) => notionWorkspace.listTasks(projectId),
      signals: (projectId) => signals.get(projectId),
      prFor: (projectId, branch) => signals.prForBranch(projectId, branch)?.number ?? null,
      getBlockChildren: (id, cursor) => notion.getBlockChildren(id, cursor),
      searchPages: (query) => notion.searchPages(query),
      notionInsert: {
        createChildPage: (parent, title, markdown) =>
          notion.createChildPage(parent, title, markdown),
        appendMarkdown: (pageId, markdown) => notion.appendMarkdown(pageId, markdown)
      },
      send,
      isTrustedSender,
      ready: projectsReady
    })
    claudeRuns = claude.runs

    // Fluxos de tarefa (5A): passos ligados às colunas, sobre as execuções da 4A.
    flowRunner = createFlowRunner({
      boardStore,
      configStore,
      board,
      claude: claude.service,
      runs: claude.runs,
      worktrees: claude.worktrees,
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
      }),
      send,
      isTrustedSender,
      ready: projectsReady
    })

    void projectsReady.then(async () => {
      // Retoma o que ficou pendente quando o app fechou.
      writeQueue?.start()
      // Liga os HeadWatchers (eventos locais na hora) e começa os ciclos.
      await projects?.list().catch(() => undefined)
      scheduler?.start()
    })
  } else {
    registerBoardIpc(ipcMain, unavailableBoard(), isTrustedSender, projectsReady)
  }
  registerShellIpc(ipcMain, (url) => shell.openExternal(url), isTrustedSender)
}

let projects: ProjectsService | null = null
let writeQueue: NotionWriteQueue | null = null
let scheduler: AutomationScheduler | null = null
let claudeRuns: RunService | null = null
let flowRunner: FlowRunner | null = null

function createFlowRunner(deps: {
  boardStore: BoardStore
  configStore: ReturnType<typeof createOrkioConfigStore>
  board: BoardService
  claude: ClaudeService
  runs: RunService
  worktrees: WorktreeService
  listTasks: ClaudeServiceDeps['listTasks']
  deliveryActions: OrkioAction[]
  send: (channel: string, payload: unknown) => void
  isTrustedSender: ReturnType<typeof createSenderGuard>
  ready: Promise<void>
}): FlowRunner {
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
  registerAlvaIpc(ipcMain, alvaFlows, deps.isTrustedSender, deps.ready)

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
    concurrencyLimit: (projectId, flow) => alvaFlows.concurrencyLimit(projectId, flow),
    notify: (title, body, ref) =>
      showNotification({ title, body, projectId: ref.projectId, taskId: ref.taskId }, deps.send),
    emit: (ref) => deps.send(IPC_CHANNELS.taskFlows.changed, ref)
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
  registerTaskFlowsIpc(ipcMain, service, runner, deps.isTrustedSender, deps.ready)
  return runner
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

function createClaude(deps: {
  boardStore: BoardStore
  git: ReturnType<typeof createGit>
  configStore: ReturnType<typeof createOrkioConfigStore>
  listTasks: ClaudeServiceDeps['listTasks']
  signals: ClaudeServiceDeps['signals']
  prFor: (projectId: string, branch: string) => number | null
  getBlockChildren: ClaudeServiceDeps['getBlockChildren']
  searchPages: ClaudeServiceDeps['searchPages']
  /** Escritas no Notion para publicar artefatos (o token fica no conector). */
  notionInsert: ArtifactsDeps['notion']
  send: (channel: string, payload: unknown) => void
  isTrustedSender: ReturnType<typeof createSenderGuard>
  ready: Promise<void>
}): {
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
      deps.send(IPC_CHANNELS.claude.runEvent, message)
    },
    notify: (title, body, ref) =>
      showNotification({ title, body, projectId: ref.projectId, taskId: ref.taskId }, deps.send)
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
    searchPages: deps.searchPages,
    detect: () => detectClaude({ env }),
    flowActive: (taskId) => flowRunner?.hasActive(taskId) ?? false,
    artifacts: new ArtifactsService({
      db: deps.boardStore.db,
      store: deps.boardStore,
      worktrees,
      git: deps.git,
      notion: deps.notionInsert
    }),
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
  registerClaudeIpc(ipcMain, service, deps.isTrustedSender, deps.ready)
  return { runs, service, worktrees, delivery }
}

/** Notificação de desktop (opcional por regra). Clique: foca o Orkio e abre a tarefa. */
function showNotification(
  n: AutomationNotification,
  send: (channel: string, payload: unknown) => void
): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: n.title, body: n.body, silent: false })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    send(IPC_CHANNELS.board.openTask, { projectId: n.projectId, taskId: n.taskId })
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

function unavailableBoard(): Parameters<typeof registerBoardIpc>[1] {
  const error = {
    ok: false as const,
    error: {
      code: 'db_unavailable',
      message:
        'O banco local do quadro não pôde ser aberto (pode ser de uma versão mais nova do Orkio).'
    }
  }
  const fail = async (): Promise<typeof error> => error
  return {
    get: fail,
    save: fail,
    move: fail,
    setBlocked: fail,
    history: fail,
    retryNow: () => {},
    setAutomationPaused: fail
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
  flowRunner?.dispose()
  claudeRuns?.cancelAll()
  projects?.dispose()
  writeQueue?.stop()
  scheduler?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

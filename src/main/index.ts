import { realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
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
import { TaskSignalsService } from './signals/task-signals.service'
import { NotionWorkspaceService } from './notion/notion-workspace.service'
import { authorizeViaLoopback } from './oauth/loopback'
import { ProjectsService } from './projects/projects.service'
import { registerGitHubIpc } from './ipc/github.ipc'
import { registerNotionIpc } from './ipc/notion.ipc'
import { registerShellIpc } from './ipc/shell.ipc'
import { createSenderGuard } from './ipc/trusted-sender'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { SecureStore } from './storage/secure-store'
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
  registerShellIpc(ipcMain, (url) => shell.openExternal(url), isTrustedSender)
}

let projects: ProjectsService | null = null

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

app.on('before-quit', () => projects?.dispose())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

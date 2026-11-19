import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron'
import { createNotionClient } from './connectors/notion/notion.client'
import { NotionConnector } from './connectors/notion/notion.connector'
import { registerNotionIpc } from './ipc/notion.ipc'
import { registerShellIpc } from './ipc/shell.ipc'
import { createSenderGuard } from './ipc/trusted-sender'
import { SecureStore } from './storage/secure-store'

const RENDERER_HTML = join(__dirname, '../renderer/index.html')
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#0A0A0B',
    title: 'Orkio',
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
  const notion = new NotionConnector({ store, client: createNotionClient() })

  registerNotionIpc(ipcMain, notion, isTrustedSender)
  registerShellIpc(ipcMain, (url) => shell.openExternal(url), isTrustedSender)
}

void app.whenReady().then(() => {
  // O app não precisa de nenhuma permissão do navegador (câmera, notificações etc.).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )

  registerIpc()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, screen, session } from 'electron'
import appIcon from '../../resources/icon.png?asset'
import { createApp } from './composition/app'
import { errorName } from './errors'
import { registerHandlers } from './ipc/register'
import { createSenderGuard } from './ipc/trusted-sender'

const RENDERER_HTML = join(__dirname, '../renderer/index.html')
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

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

  const orkio = createApp()
  // IPC só de quem é a janela do app (origem conferida em cada chamada).
  const isTrustedSender = createSenderGuard({
    devServerUrl: DEV_SERVER_URL,
    rendererFileUrl: pathToFileURL(RENDERER_HTML).href
  })
  registerHandlers(ipcMain, { isTrustedSender, ready: orkio.ready }, orkio.handlers)
  void orkio.start().catch((error: unknown) => {
    console.error(`[orkio] não foi possível iniciar: ${errorName(error)}`)
  })
  app.on('before-quit', () => void orkio.stop({ waitMs: 0 }))

  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

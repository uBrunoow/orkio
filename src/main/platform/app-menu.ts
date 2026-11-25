import type { MenuItemConstructorOptions } from 'electron'

/**
 * Menu nativo (Fase 0). Os menus do Orkio (Sessão, Ir, Janela, Ajuda) ficam na barra do próprio
 * app; o menu padrão do Electron sai porque os atalhos dele (Ctrl+W fecha a janela, Ctrl+R
 * recarrega) brigariam com os do app (Ctrl+W fecha a aba). Fica só o essencial: no macOS o menu
 * do app e Editar (sem eles, ⌘C/⌘V não funcionam); em dev, Exibir (recarregar, DevTools).
 * Fora do macOS a barra nativa fica escondida.
 */
export function appMenuTemplate(options: {
  platform: NodeJS.Platform
  dev: boolean
}): MenuItemConstructorOptions[] {
  const dev: MenuItemConstructorOptions[] = options.dev ? [{ role: 'viewMenu' }] : []
  if (options.platform === 'darwin') {
    return [
      { role: 'appMenu' },
      { role: 'editMenu' },
      ...dev,
      {
        label: 'Janela',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }]
      }
    ]
  }
  return [{ role: 'editMenu' }, ...dev]
}

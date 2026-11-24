import { BrowserWindow, type BaseWindow } from 'electron'

interface DialogFn<O, R> {
  (window: BaseWindow, options: O): Promise<R>
  (options: O): Promise<R>
}

/** Mostra o diálogo preso à janela em foco (ou à primeira aberta); sem janela, solto. */
export function withDialogWindow<O, R>(show: DialogFn<O, R>, options: O): Promise<R> {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  return win ? show(win, options) : show(options)
}

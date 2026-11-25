/**
 * Fase 4: atalho global para trazer o Orkio para a frente (Configurações › Atalhos). Só aceita a
 * lista fechada de `GLOBAL_SHORTCUTS`; registrar de novo troca o anterior. Falha (atalho já usado
 * por outro app) não derruba nada: devolve `false`.
 */
import { BrowserWindow, globalShortcut } from 'electron'
import { GLOBAL_SHORTCUTS, type GlobalShortcut } from '../../shared/preferences'

let current: GlobalShortcut | null = null

export function applyGlobalShortcut(accelerator: GlobalShortcut | null): boolean {
  if (current === accelerator) return true
  if (current) globalShortcut.unregister(current)
  current = null
  if (!accelerator || !(GLOBAL_SHORTCUTS as readonly string[]).includes(accelerator)) return true
  try {
    const ok = globalShortcut.register(accelerator, () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    if (ok) current = accelerator
    return ok
  } catch {
    return false
  }
}

export function clearGlobalShortcut(): void {
  if (current) globalShortcut.unregister(current)
  current = null
}

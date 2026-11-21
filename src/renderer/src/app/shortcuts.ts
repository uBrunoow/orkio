/**
 * Atalhos globais do app (6E). Puro: recebe o essencial de um `KeyboardEvent` e devolve a ação.
 * Atalhos do Quadro (J/K, setas, M) ficam no próprio quadro.
 */
import { ROUTE_TITLES, type Route } from './routes'

export interface Shortcut {
  /** Formato do `Kbd` da Astryx (`mod` = Ctrl, ou ⌘ no Mac). */
  keys: string
  label: string
  route: Route
  /** Tela do projeto atual (só faz sentido com um projeto vinculado). */
  isProjectScreen?: boolean
}

/** Telas por número, na ordem do menu: Visão geral, as do projeto atual, Projetos, Integrações, Configurações. */
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'mod+1', label: ROUTE_TITLES.overview, route: { name: 'overview' } },
  { keys: 'mod+2', label: ROUTE_TITLES.board, route: { name: 'board' }, isProjectScreen: true },
  {
    keys: 'mod+3',
    label: ROUTE_TITLES.automations,
    route: { name: 'automations' },
    isProjectScreen: true
  },
  { keys: 'mod+4', label: ROUTE_TITLES.flows, route: { name: 'flows' }, isProjectScreen: true },
  { keys: 'mod+5', label: ROUTE_TITLES.context, route: { name: 'context' }, isProjectScreen: true },
  { keys: 'mod+6', label: ROUTE_TITLES.projects, route: { name: 'projects' } },
  { keys: 'mod+7', label: ROUTE_TITLES.integrations, route: { name: 'integrations' } },
  { keys: 'mod+8', label: ROUTE_TITLES.settings, route: { name: 'settings' } }
]

export type GlobalAction =
  { type: 'palette' } | { type: 'navigate'; route: Route } | { type: 'back' }

export interface KeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** Foco num campo de texto (input, textarea, contenteditable). */
  inTextField: boolean
}

export function globalShortcut(e: KeyInput, isMac: boolean): GlobalAction | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (mod && !e.altKey && !e.shiftKey) {
    if (e.key.toLowerCase() === 'k') return { type: 'palette' }
    if (e.key === '[') return { type: 'back' }
    const n = Number(e.key)
    const shortcut = Number.isInteger(n) && n >= 1 ? SHORTCUTS[n - 1] : undefined
    if (shortcut) return { type: 'navigate', route: shortcut.route }
    return null
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft') {
    return e.inTextField ? null : { type: 'back' }
  }
  // "?" abre a paleta, que mostra os atalhos ao lado de cada tela.
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.inTextField) {
    return { type: 'palette' }
  }
  return null
}

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(target.type)
  }
  return target.getAttribute('role') === 'combobox'
}

/**
 * Atalhos de teclado (Fase 0): um formato só (`mod+shift+t`, `alt+arrowleft`, `?`) para o registro
 * de comandos, os menus, a paleta e o `aria-keyshortcuts`. `mod` = Ctrl, ou ⌘ no Mac. Puro.
 */

export interface KeyInput {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  inTextField: boolean
}

interface Chord {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

const MODIFIERS = new Set(['mod', 'ctrl', 'alt', 'shift'])

function parse(keys: string): Chord {
  const parts = keys.toLowerCase().split('+')
  // "mod++" (tecla "+"): o último pedaço vazio é a própria tecla.
  const key = parts.at(-1) === '' ? '+' : (parts.at(-1) ?? '')
  const mods = new Set(parts.slice(0, -1).filter((p) => MODIFIERS.has(p)))
  return {
    mod: mods.has('mod'),
    ctrl: mods.has('ctrl'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    key
  }
}

/**
 * A tecla bate com o atalho? Sem Ctrl/⌘ (ex.: `?`, `alt+arrowleft`), nunca num campo de texto. A
 * tecla é comparada sem caixa; `shift` só é exigido quando o atalho pede (e `?` já vem com shift).
 */
export function matchesKeys(keys: string, e: KeyInput, isMac: boolean): boolean {
  const c = parse(keys)
  const ctrl = c.ctrl || (c.mod && !isMac)
  const meta = c.mod && isMac
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== c.alt) return false
  const printable = c.key.length === 1 && !/[a-z0-9]/.test(c.key)
  if (!printable && e.shiftKey !== c.shift) return false
  // Num campo de texto só valem atalhos com Ctrl/⌘ (Alt+← e "?" são do próprio campo).
  if (!c.mod && !c.ctrl && e.inTextField) return false
  return e.key.toLowerCase() === c.key
}

const LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  enter: 'Enter',
  tab: 'Tab',
  escape: 'Esc'
}

/** "mod+shift+t" → "Ctrl Shift T" / "⌘ ⇧ T". */
export function formatKeys(keys: string, isMac: boolean): string {
  const c = parse(keys)
  const parts: string[] = []
  if (c.ctrl) parts.push(isMac ? '⌃' : 'Ctrl')
  if (c.mod) parts.push(isMac ? '⌘' : 'Ctrl')
  if (c.alt) parts.push(isMac ? '⌥' : 'Alt')
  if (c.shift) parts.push(isMac ? '⇧' : 'Shift')
  parts.push(LABELS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key))
  return parts.join(' ')
}

/** Valor de `aria-keyshortcuts` ("Control+Shift+T", "Meta+K"). */
export function ariaKeys(keys: string, isMac: boolean): string {
  const c = parse(keys)
  const parts: string[] = []
  if (c.ctrl || (c.mod && !isMac)) parts.push('Control')
  if (c.mod && isMac) parts.push('Meta')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  const named: Record<string, string> = {
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    tab: 'Tab',
    enter: 'Enter'
  }
  parts.push(named[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key))
  return parts.join('+')
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

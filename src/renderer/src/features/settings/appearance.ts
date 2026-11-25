/**
 * Aparência (Configurações › Aparência): só deste computador, em `localStorage`
 * (`orkio.appearance`). Aplicada como atributos no `<html>` (`data-theme`, `data-motion`,
 * `data-text-size`, `data-tracking`, `data-ui-font`, `data-code-font`, `data-wallpaper`) que o
 * `globals.css` lê: nada de `<style>` em runtime (CSP). O padrão de cada campo tira o atributo.
 */
import { createLocalPref } from './local-prefs'

export const THEMES = ['dark', 'light', 'system'] as const
export type ThemePref = (typeof THEMES)[number]

export const MOTION_PREFS = ['system', 'reduce'] as const
export type MotionPref = (typeof MOTION_PREFS)[number]

export const TEXT_SIZES = ['small', 'normal', 'large', 'larger'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const TRACKINGS = ['tight', 'normal', 'relaxed', 'wide'] as const
export type Tracking = (typeof TRACKINGS)[number]

export const UI_FONTS = ['inter', 'geist', 'figtree', 'system'] as const
export type UiFont = (typeof UI_FONTS)[number]

export const CODE_FONTS = ['jetbrains', 'geist-mono', 'system'] as const
export type CodeFont = (typeof CODE_FONTS)[number]

export const WALLPAPERS = [
  'flat',
  'ember',
  'mesh',
  'carbon',
  'esmeralda',
  'oceano',
  'orquidea',
  'dracula',
  'nord',
  'catppuccin'
] as const
export type Wallpaper = (typeof WALLPAPERS)[number]

export type Appearance = {
  theme: ThemePref
  /** `system` = segue o `prefers-reduced-motion`; `reduce` = sempre sem animação. */
  motion: MotionPref
  text: TextSize
  tracking: Tracking
  uiFont: UiFont
  codeFont: CodeFont
  wallpaper: Wallpaper
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'dark',
  motion: 'system',
  text: 'normal',
  tracking: 'normal',
  uiFont: 'inter',
  codeFont: 'jetbrains',
  wallpaper: 'flat'
}

export const APPEARANCE_KEY = 'orkio.appearance'

export const appearancePref = createLocalPref<Appearance>(
  APPEARANCE_KEY,
  {
    theme: THEMES,
    motion: MOTION_PREFS,
    text: TEXT_SIZES,
    tracking: TRACKINGS,
    uiFont: UI_FONTS,
    codeFont: CODE_FONTS,
    wallpaper: WALLPAPERS
  },
  DEFAULT_APPEARANCE,
  (a) => applyAppearance(a)
)

/** Valor salvo (texto JSON) → aparência; campo inválido volta ao padrão. */
export const parseAppearance = (raw: string | null): Appearance => appearancePref.parse(raw)
export const readAppearance = (): Appearance => appearancePref.read()
/** Salva (se der) e aplica na hora. */
export const saveAppearance = (a: Appearance): void => appearancePref.save(a)

/** O sistema prefere o claro? (`system` resolve por aqui). */
function systemPrefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

/** Tema que vale agora (`system` resolvido). */
export function resolvedTheme(
  theme: ThemePref,
  prefersLight = systemPrefersLight
): 'dark' | 'light' {
  if (theme === 'system') return prefersLight() ? 'light' : 'dark'
  return theme
}

function setData(root: HTMLElement, key: string, value: string, fallback: string): void {
  if (value === fallback) delete root.dataset[key]
  else root.dataset[key] = value
}

/** Põe a aparência no `<html>` (o padrão tira os atributos). */
export function applyAppearance(
  a: Appearance,
  root: HTMLElement = document.documentElement,
  prefersLight: () => boolean = systemPrefersLight
): void {
  const d = DEFAULT_APPEARANCE
  const theme = resolvedTheme(a.theme, prefersLight)
  setData(root, 'theme', theme, 'dark')
  // Variantes `dark:` dos componentes do shadcn valem só no escuro.
  root.classList?.toggle('dark', theme === 'dark')
  setData(root, 'motion', a.motion, d.motion)
  setData(root, 'textSize', a.text, d.text)
  setData(root, 'tracking', a.tracking, d.tracking)
  setData(root, 'uiFont', a.uiFont, d.uiFont)
  setData(root, 'codeFont', a.codeFont, d.codeFont)
  setData(root, 'wallpaper', a.wallpaper, d.wallpaper)
}

/** Na abertura do app (antes do primeiro desenho); com "Sistema", acompanha o sistema mudar. */
export function applySavedAppearance(): void {
  applyAppearance(readAppearance())
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (readAppearance().theme === 'system') applyAppearance(readAppearance())
    })
  } catch {
    // Sem matchMedia: o tema "Sistema" fica no escuro.
  }
}

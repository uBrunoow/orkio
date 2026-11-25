/**
 * Aparência (Configurações › Aparência): só deste computador, em `localStorage`
 * (`orkio.appearance`). Aplicada como atributos no `<html>` (`data-motion`, `data-text-size`) que o
 * `globals.css` lê: nada de `<style>` em runtime (CSP).
 */

export const MOTION_PREFS = ['system', 'reduce'] as const
export type MotionPref = (typeof MOTION_PREFS)[number]

export const TEXT_SIZES = ['normal', 'large', 'larger'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export interface Appearance {
  /** `system` = segue o `prefers-reduced-motion`; `reduce` = sempre sem animação. */
  motion: MotionPref
  text: TextSize
}

export const DEFAULT_APPEARANCE: Appearance = { motion: 'system', text: 'normal' }

export const APPEARANCE_KEY = 'orkio.appearance'

/** Valor salvo (texto JSON) → aparência; campo inválido volta ao padrão. */
export function parseAppearance(raw: string | null): Appearance {
  let v: unknown
  try {
    v = raw ? JSON.parse(raw) : null
  } catch {
    v = null
  }
  const r = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  return {
    motion: (MOTION_PREFS as readonly unknown[]).includes(r['motion'])
      ? (r['motion'] as MotionPref)
      : DEFAULT_APPEARANCE.motion,
    text: (TEXT_SIZES as readonly unknown[]).includes(r['text'])
      ? (r['text'] as TextSize)
      : DEFAULT_APPEARANCE.text
  }
}

export function readAppearance(): Appearance {
  try {
    return parseAppearance(window.localStorage.getItem(APPEARANCE_KEY))
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** Põe a aparência no `<html>` (o padrão tira os atributos). */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.motion === 'reduce') root.dataset['motion'] = 'reduce'
  else delete root.dataset['motion']
  if (a.text === 'normal') delete root.dataset['textSize']
  else root.dataset['textSize'] = a.text
}

/** Salva (se der) e aplica na hora. */
export function saveAppearance(a: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a))
  } catch {
    // Sem armazenamento: vale só até fechar o app.
  }
  applyAppearance(a)
}

/** Na abertura do app (antes do primeiro desenho). */
export function applySavedAppearance(): void {
  applyAppearance(readAppearance())
}

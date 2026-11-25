/**
 * Layout (Configurações › Layout): como desktops, painéis e páginas se arrumam. Só deste
 * computador (`orkio.layout`). A largura das páginas vai para o `<html>` (`data-page-width`, que
 * o `globals.css` lê); o resto o App lê com `layoutPref.use()`.
 */
import type { Arrangement } from '../../app/desktops'
import { createLocalPref } from './local-prefs'

export const NEW_DESKTOP_ARRANGEMENTS = ['single', 'main-stack', 'columns', 'grid'] as const

export const PANEL_GAPS = ['joined', 'spaced'] as const
export type PanelGap = (typeof PANEL_GAPS)[number]

export const DESKTOP_TRANSITIONS = ['slide', 'fade', 'instant'] as const
export type DesktopTransition = (typeof DESKTOP_TRANSITIONS)[number]

export const FOCUS_MODES = ['click', 'hover'] as const
export type FocusMode = (typeof FOCUS_MODES)[number]

export const PAGE_WIDTHS = ['centered', 'full'] as const
export type PageWidth = (typeof PAGE_WIDTHS)[number]

export type LayoutPrefs = {
  /** Arranjo de um desktop novo. */
  newDesktop: Arrangement
  /** Painéis lado a lado: colados por uma linha ou com respiro e cantos. */
  gap: PanelGap
  /** Ao trocar de desktop. */
  transition: DesktopTransition
  /** `hover` = passar o ponteiro sobre um painel já o torna o ativo. */
  focus: FocusMode
  /** Telas de leitura e formulário: centralizadas com respiro ou na largura toda. */
  pageWidth: PageWidth
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  newDesktop: 'single',
  gap: 'joined',
  transition: 'slide',
  focus: 'click',
  pageWidth: 'centered'
}

export function applyLayout(l: LayoutPrefs, root: HTMLElement = document.documentElement): void {
  if (l.pageWidth === 'full') root.dataset['pageWidth'] = 'full'
  else delete root.dataset['pageWidth']
}

export const layoutPref = createLocalPref<LayoutPrefs>(
  'orkio.layout',
  {
    newDesktop: NEW_DESKTOP_ARRANGEMENTS,
    gap: PANEL_GAPS,
    transition: DESKTOP_TRANSITIONS,
    focus: FOCUS_MODES,
    pageWidth: PAGE_WIDTHS
  },
  DEFAULT_LAYOUT,
  (l) => applyLayout(l)
)

export function applySavedLayout(): void {
  applyLayout(layoutPref.read())
}

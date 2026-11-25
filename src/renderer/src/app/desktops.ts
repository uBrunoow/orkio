/**
 * Desktops e divisão lado a lado (Fase 5). Puro. Um desktop = um conjunto de abas (`TabsState`)
 * com nome e arranjo próprios (ex.: um por projeto ou atividade). Só o desktop atual fica na tela;
 * os outros guardam as abas (com o "Voltar" de cada uma) até voltar a eles.
 *
 * Um lugar = uma aba vale dentro de cada desktop: o mesmo Quadro pode estar aberto em dois
 * desktops. Navegar (dock, sino, paleta) sempre age no desktop atual. Mover uma aba para um
 * desktop onde o lugar já tem aba ativa a que existe lá (a que chegou some).
 */
import {
  EMPTY_TABS,
  MAX_CLOSED,
  adoptTab,
  parseSavedTabs,
  serializeTabs,
  takeTab,
  tabsReducer,
  visibleTabs,
  type SavedTabs,
  type Tab,
  type TabsAction,
  type TabsState
} from './tabs'

export type Arrangement = 'single' | 'main-stack' | 'columns' | 'grid'

export interface ArrangementInfo {
  id: Arrangement
  label: string
  /** Frase curta para a paleta e o menu. */
  hint: string
  /** Quantas abas ficam visíveis (painéis) neste arranjo. */
  panels: number
}

export const ARRANGEMENTS: readonly ArrangementInfo[] = [
  { id: 'single', label: 'Uma aba', hint: 'Só a aba ativa na tela', panels: 1 },
  {
    id: 'main-stack',
    label: 'Principal + pilha',
    hint: 'Uma aba grande e duas empilhadas ao lado',
    panels: 3
  },
  { id: 'columns', label: 'Colunas', hint: 'Até três abas lado a lado', panels: 3 },
  { id: 'grid', label: 'Grade', hint: 'Até quatro abas em grade', panels: 4 }
]

export function arrangementOf(id: Arrangement): ArrangementInfo {
  return ARRANGEMENTS.find((a) => a.id === id) ?? ARRANGEMENTS[0]!
}

export const MAX_DESKTOPS = 9
export const MAX_DESKTOP_NAME = 40

export interface Desktop {
  id: string
  name: string
  tabs: TabsState
  arrangement: Arrangement
}

export interface DesktopsState {
  desktops: Desktop[]
  activeId: string
  seq: number
}

export type DesktopsAction =
  /** Ação de abas no desktop atual. */
  | { type: 'tabs'; action: TabsAction }
  /** Desktop novo (com uma aba Início), que vira o atual. */
  | { type: 'create'; name?: string; arrangement?: Arrangement }
  | { type: 'switch'; id: string }
  /** Próximo (+1) ou anterior (-1), dando a volta. */
  | { type: 'cycle'; offset: 1 | -1 }
  /** `id` ausente = o atual. Nome vazio não muda nada. */
  | { type: 'rename'; id?: string; name: string }
  /** `id` ausente = o atual. O último não se apaga. */
  | { type: 'remove'; id?: string }
  | { type: 'arrange'; arrangement: Arrangement }
  /** Leva a aba (`tabId` ausente = a ativa) do desktop atual para outro (ou para um novo). */
  | { type: 'move-tab'; tabId?: string; to: string | 'new' }
  | { type: 'restore'; saved: SavedDesktops }

function desktop(id: string, name: string, tabs: TabsState = EMPTY_TABS): Desktop {
  return { id, name, tabs, arrangement: 'single' }
}

export const EMPTY_DESKTOPS: DesktopsState = {
  desktops: [desktop('d1', 'Desktop 1')],
  activeId: 'd1',
  seq: 1
}

export function activeDesktop(state: DesktopsState): Desktop {
  return state.desktops.find((d) => d.id === state.activeId) ?? state.desktops[0]!
}

/** Abas na tela do desktop atual (a ativa e, numa divisão, as vizinhas usadas por último). */
export function visiblePanels(d: Desktop): Tab[] {
  return visibleTabs(d.tabs, arrangementOf(d.arrangement).panels)
}

/** "Desktop N" com o menor N livre. */
export function nextDesktopName(desktops: readonly Desktop[]): string {
  const used = new Set(desktops.map((d) => d.name))
  let n = 1
  while (used.has(`Desktop ${n}`)) n++
  return `Desktop ${n}`
}

export function cleanDesktopName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_DESKTOP_NAME)
}

function withDesktop(
  state: DesktopsState,
  id: string,
  change: (d: Desktop) => Desktop
): DesktopsState {
  return { ...state, desktops: state.desktops.map((d) => (d.id === id ? change(d) : d)) }
}

/** Desktop novo com uma aba Início (ou a aba recebida). */
function create(state: DesktopsState, name: string | undefined, tab?: Tab): DesktopsState | null {
  if (state.desktops.length >= MAX_DESKTOPS) return null
  const seq = state.seq + 1
  const id = `d${seq}`
  const clean = name === undefined ? '' : cleanDesktopName(name)
  const tabs = tab ? adoptTab(EMPTY_TABS, tab) : tabsReducer(EMPTY_TABS, { type: 'open' })
  const fresh = desktop(id, clean || nextDesktopName(state.desktops), tabs)
  const at = state.desktops.findIndex((d) => d.id === state.activeId)
  const desktops = [...state.desktops]
  desktops.splice(at + 1, 0, fresh)
  return { ...state, seq, desktops }
}

function moveTab(state: DesktopsState, tabId: string | undefined, to: string): DesktopsState {
  const from = activeDesktop(state)
  const id = tabId ?? from.tabs.activeId
  if (!id || to === from.id) return state
  const taken = takeTab(from.tabs, id)
  if (!taken) return state
  if (to === 'new') {
    const created = create(state, undefined, taken.tab)
    if (!created) return state
    return withDesktop(created, from.id, (d) => ({ ...d, tabs: taken.state }))
  }
  if (!state.desktops.some((d) => d.id === to)) return state
  const moved = withDesktop(state, from.id, (d) => ({ ...d, tabs: taken.state }))
  return withDesktop(moved, to, (d) => ({ ...d, tabs: adoptTab(d.tabs, taken.tab) }))
}

export function desktopsReducer(state: DesktopsState, action: DesktopsAction): DesktopsState {
  switch (action.type) {
    case 'tabs':
      return withDesktop(state, activeDesktop(state).id, (d) => ({
        ...d,
        tabs: tabsReducer(d.tabs, action.action)
      }))
    case 'create': {
      const created = create(state, action.name)
      if (!created) return state
      const at = created.desktops.findIndex((d) => d.id === state.activeId)
      const id = created.desktops[at + 1]!.id
      const next = { ...created, activeId: id }
      return action.arrangement
        ? withDesktop(next, id, (d) => ({ ...d, arrangement: action.arrangement! }))
        : next
    }
    case 'switch':
      return state.desktops.some((d) => d.id === action.id)
        ? { ...state, activeId: action.id }
        : state
    case 'cycle': {
      const n = state.desktops.length
      if (n < 2) return state
      const i = state.desktops.findIndex((d) => d.id === state.activeId)
      return { ...state, activeId: state.desktops[(i + action.offset + n) % n]!.id }
    }
    case 'rename': {
      const name = cleanDesktopName(action.name)
      if (!name) return state
      return withDesktop(state, action.id ?? state.activeId, (d) => ({ ...d, name }))
    }
    case 'remove': {
      const id = action.id ?? state.activeId
      const index = state.desktops.findIndex((d) => d.id === id)
      if (index === -1 || state.desktops.length < 2) return state
      const gone = state.desktops[index]!
      const desktops = state.desktops.filter((d) => d.id !== id)
      const neighbor = desktops[Math.max(0, index - 1)]!
      // As abas do desktop apagado vão para "Reabrir aba fechada" do vizinho.
      const routes = gone.tabs.tabs.map((t) => t.router.route).filter((r) => r.name !== 'home')
      const next: DesktopsState = {
        ...state,
        desktops,
        activeId: state.activeId === id ? neighbor.id : state.activeId
      }
      return withDesktop(next, neighbor.id, (d) => ({
        ...d,
        tabs: { ...d.tabs, closed: [...d.tabs.closed, ...routes].slice(-MAX_CLOSED) }
      }))
    }
    case 'arrange':
      return withDesktop(state, state.activeId, (d) => ({ ...d, arrangement: action.arrangement }))
    case 'move-tab':
      return moveTab(state, action.tabId, action.to)
    case 'restore': {
      const saved = action.saved
      if (saved.desktops.length === 0) return state
      const desktops = saved.desktops.slice(0, MAX_DESKTOPS).map((s, i) => {
        let tabs = s.tabs ? tabsReducer(EMPTY_TABS, { type: 'restore', ...s.tabs }) : EMPTY_TABS
        if (tabs.tabs.length === 0 && i !== saved.active) {
          tabs = tabsReducer(tabs, { type: 'open' })
        }
        return { id: `d${i + 1}`, name: s.name, tabs, arrangement: s.arrangement }
      })
      // Primeiros passos por cima continuam por cima (o overlay não é salvo).
      const overlay = activeDesktop(state).tabs.overlay
      const activeIndex = Math.min(Math.max(0, saved.active), desktops.length - 1)
      const active = desktops[activeIndex]!
      active.tabs = { ...active.tabs, overlay }
      return { desktops, activeId: active.id, seq: desktops.length }
    }
  }
}

// --- Desktops salvos (reabrir o app) ---------------------------------------------------------

export interface SavedDesktop {
  name: string
  arrangement: Arrangement
  /** `null` = sem abas aproveitáveis (volta com uma Início). */
  tabs: SavedTabs | null
}

export interface SavedDesktops {
  desktops: SavedDesktop[]
  active: number
}

export function serializeDesktops(state: DesktopsState): SavedDesktops {
  return {
    desktops: state.desktops.map((d) => ({
      name: d.name,
      arrangement: d.arrangement,
      tabs: d.tabs.tabs.length > 0 ? serializeTabs(d.tabs) : null
    })),
    active: Math.max(
      0,
      state.desktops.findIndex((d) => d.id === state.activeId)
    )
  }
}

const isArrangement = (v: unknown): v is Arrangement => ARRANGEMENTS.some((a) => a.id === v)

/** Desktops salvos, validados (nome, arranjo e cada rota por `parseRoute`); nada = `null`. */
export function parseSavedDesktops(value: unknown): SavedDesktops | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { desktops?: unknown; active?: unknown }
  if (!Array.isArray(v.desktops)) return null
  const desktops: SavedDesktop[] = []
  for (const raw of v.desktops.slice(0, MAX_DESKTOPS)) {
    if (typeof raw !== 'object' || raw === null) continue
    const d = raw as { name?: unknown; arrangement?: unknown; tabs?: unknown }
    const name = typeof d.name === 'string' ? cleanDesktopName(d.name) : ''
    desktops.push({
      name: name || `Desktop ${desktops.length + 1}`,
      arrangement: isArrangement(d.arrangement) ? d.arrangement : 'single',
      tabs: parseSavedTabs(d.tabs)
    })
  }
  if (desktops.length === 0) return null
  const active = typeof v.active === 'number' && Number.isInteger(v.active) ? v.active : 0
  return { desktops, active: Math.min(Math.max(0, active), desktops.length - 1) }
}

/**
 * O que restaurar ao abrir: os desktops salvos; senão, as abas do formato antigo (`orkio.tabs`,
 * antes da Fase 5) viram o "Desktop 1".
 */
export function loadSavedDesktops(desktops: unknown, legacyTabs: unknown): SavedDesktops | null {
  const saved = parseSavedDesktops(desktops)
  if (saved) return saved
  const tabs = parseSavedTabs(legacyTabs)
  if (!tabs) return null
  return { desktops: [{ name: 'Desktop 1', arrangement: 'single', tabs }], active: 0 }
}

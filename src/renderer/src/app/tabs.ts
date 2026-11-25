/**
 * Abas do app (Fase 0). Puro. Cada aba tem o próprio roteador (rota, chave e "Voltar"); cada
 * lugar (`placeOf`: uma tela, uma tarefa) tem no máximo uma aba, então abrir de novo ativa a que
 * já existe. "Nova aba" abre a tela Início, que vira o lugar para onde se navega a partir dela.
 * Primeiros passos não é aba: fica por cima de tudo (`overlay`).
 *
 * Desktops e divisão lado a lado (Fase 5) entram em volta disto: um desktop = um `TabsState`, e
 * uma divisão = mais de uma aba visível do mesmo estado. Nada aqui supõe uma aba visível só, além
 * de `activeId`.
 */
import {
  initialRouter,
  parseRoute,
  placeOf,
  boardRouteAsIs,
  routerReducer,
  type Route,
  type RouterState
} from './routes'

export interface Tab {
  id: string
  router: RouterState
  /** Ordem de uso (maior = usada por último): decide quem sai quando passa do limite. */
  seen: number
}

export interface TabsState {
  tabs: Tab[]
  activeId: string | null
  /** Primeiros passos, por cima das abas (`null` = mostra as abas). */
  overlay: Extract<Route, { name: 'setup' }> | null
  /** Rotas das abas fechadas, a última no fim ("Reabrir aba fechada"). */
  closed: Route[]
  seq: number
}

export const MAX_TABS = 12
export const MAX_CLOSED = 10

export type TabsAction =
  /** Vai para a rota: na aba do lugar (se existir), na aba Início atual ou numa aba nova. */
  | { type: 'navigate'; route: Route }
  /** Primeira tela do app (sem "Voltar"). */
  | { type: 'reset'; route: Route }
  /** Troca a rota da aba (`id` ausente = a ativa) sem remontar a tela (abas internas). */
  | { type: 'replace'; route: Route; id?: string }
  | { type: 'back' }
  /** Aba nova: Início (ou a rota pedida, respeitando um lugar = uma aba). */
  | { type: 'open'; route?: Route }
  | { type: 'activate'; id: string }
  /** Próxima (+1) ou anterior (-1), dando a volta. */
  | { type: 'cycle'; offset: 1 | -1 }
  /** `id` ausente = a aba ativa. */
  | { type: 'close'; id?: string }
  | { type: 'reopen' }
  /** Move a aba para a posição `index` (arrastar). */
  | { type: 'move'; id: string; index: number }
  /** Move a aba ativa uma posição para a esquerda (-1) ou direita (+1). */
  | { type: 'shift'; offset: 1 | -1 }
  | { type: 'restore'; routes: Route[]; active: number }

export const EMPTY_TABS: TabsState = { tabs: [], activeId: null, overlay: null, closed: [], seq: 0 }

export function activeTab(state: TabsState): Tab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null
}

/** A rota que está na tela (Primeiros passos por cima, senão a da aba ativa). */
export function currentRoute(state: TabsState): Route | null {
  return state.overlay ?? activeTab(state)?.router.route ?? null
}

function touch(state: TabsState, id: string): TabsState {
  const seq = state.seq + 1
  return {
    ...state,
    seq,
    activeId: id,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, seen: seq } : t))
  }
}

function withRouter(state: TabsState, id: string, router: RouterState): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, router } : t)) }
}

/** Abre uma aba nova logo depois da ativa e a ativa; passou do limite, sai a menos usada. */
function addTab(state: TabsState, route: Route): TabsState {
  return insertTab(state, (seq) => ({
    id: `t${seq}`,
    router: initialRouter(route, seq),
    seen: seq
  }))
}

function insertTab(state: TabsState, make: (seq: number) => Tab): TabsState {
  const seq = state.seq + 1
  const tab = make(seq)
  const at = state.tabs.findIndex((t) => t.id === state.activeId)
  const tabs = [...state.tabs]
  tabs.splice(at === -1 ? tabs.length : at + 1, 0, tab)
  let next: TabsState = { ...state, seq, tabs, activeId: tab.id }
  while (next.tabs.length > MAX_TABS) {
    const oldest = next.tabs
      .filter((t) => t.id !== tab.id)
      .reduce((a, b) => (b.seen < a.seen ? b : a))
    next = { ...next, tabs: next.tabs.filter((t) => t.id !== oldest.id) }
  }
  return next
}

function navigate(state: TabsState, route: Route, reset: boolean): TabsState {
  if (route.name === 'setup') return { ...state, overlay: route }
  const base: TabsState = { ...state, overlay: null }
  const active = activeTab(base)
  const place = placeOf(route)
  const go = (router: RouterState): RouterState => {
    const target = boardRouteAsIs(router.route, route)
    return reset
      ? initialRouter(target, router.key + 1)
      : routerReducer(router, { type: 'navigate', route: target })
  }

  if (active && place !== null && placeOf(active.router.route) === place) {
    return withRouter(base, active.id, go(active.router))
  }
  const existing = place === null ? null : base.tabs.find((t) => placeOf(t.router.route) === place)
  if (existing) {
    // Sair de uma aba Início para um lugar que já tem aba: a Início some (não fica aba vazia).
    const leaving =
      active && active.router.route.name === 'home'
        ? { ...base, tabs: base.tabs.filter((t) => t.id !== active.id) }
        : base
    return touch(withRouter(leaving, existing.id, go(existing.router)), existing.id)
  }
  if (active && active.router.route.name === 'home') {
    return touch(withRouter(base, active.id, go(active.router)), active.id)
  }
  return addTab(base, route)
}

function close(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return state
  const tab = state.tabs[index]!
  const tabs = state.tabs.filter((t) => t.id !== id)
  const closed = [...state.closed, tab.router.route].slice(-MAX_CLOSED)
  if (tabs.length === 0) {
    // Sem abas, sobra uma Início (ponto de partida, nunca tela vazia).
    return addTab({ ...state, tabs, closed, activeId: null }, { name: 'home' })
  }
  if (state.activeId !== id) return { ...state, tabs, closed }
  const neighbor = tabs[Math.min(index, tabs.length - 1)]!
  return touch({ ...state, tabs, closed }, neighbor.id)
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'navigate':
      return navigate(state, action.route, false)
    case 'reset':
      return navigate(state, action.route, true)
    case 'replace': {
      const tab = action.id ? state.tabs.find((t) => t.id === action.id) : activeTab(state)
      if (!tab || state.overlay) return state
      return withRouter(state, tab.id, routerReducer(tab.router, action))
    }
    case 'back': {
      const active = activeTab(state)
      if (!active || state.overlay) return state
      return withRouter(state, active.id, routerReducer(active.router, action))
    }
    case 'open': {
      const route = action.route ?? { name: 'home' }
      if (placeOf(route) !== null) {
        const existing = state.tabs.find((t) => placeOf(t.router.route) === placeOf(route))
        if (existing) return touch({ ...state, overlay: null }, existing.id)
      }
      return addTab({ ...state, overlay: null }, route)
    }
    case 'activate':
      return state.tabs.some((t) => t.id === action.id)
        ? touch({ ...state, overlay: null }, action.id)
        : state
    case 'cycle': {
      const n = state.tabs.length
      if (n < 2) return state
      const i = state.tabs.findIndex((t) => t.id === state.activeId)
      return touch(state, state.tabs[(i + action.offset + n) % n]!.id)
    }
    case 'close':
      return close(state, action.id ?? state.activeId ?? '')
    case 'reopen': {
      const route = state.closed.at(-1)
      if (!route) return state
      return tabsReducer({ ...state, closed: state.closed.slice(0, -1) }, { type: 'open', route })
    }
    case 'move': {
      const from = state.tabs.findIndex((t) => t.id === action.id)
      if (from === -1) return state
      const tabs = [...state.tabs]
      const [tab] = tabs.splice(from, 1)
      tabs.splice(Math.max(0, Math.min(action.index, tabs.length)), 0, tab!)
      return { ...state, tabs }
    }
    case 'shift': {
      const from = state.tabs.findIndex((t) => t.id === state.activeId)
      if (from === -1) return state
      return tabsReducer(state, {
        type: 'move',
        id: state.activeId!,
        index: from + action.offset
      })
    }
    case 'restore': {
      let next: TabsState = { ...EMPTY_TABS, overlay: state.overlay }
      for (const route of action.routes) next = tabsReducer(next, { type: 'open', route })
      const active = next.tabs[action.active] ?? next.tabs[0]
      return active ? touch(next, active.id) : next
    }
  }
}

// --- Divisão e mover entre desktops (Fase 5) -------------------------------------------------

/**
 * Abas visíveis numa divisão de até `max` painéis: a ativa e as usadas por último, na ordem da
 * faixa de abas (a posição na tela segue a faixa; arrastar a aba muda o painel de lugar).
 */
export function visibleTabs(state: TabsState, max: number): Tab[] {
  const active = activeTab(state)
  if (!active) return []
  if (max <= 1) return [active]
  const others = state.tabs
    .filter((t) => t.id !== active.id)
    .sort((a, b) => b.seen - a.seen)
    .slice(0, max - 1)
  const ids = new Set([active.id, ...others.map((t) => t.id)])
  return state.tabs.filter((t) => ids.has(t.id))
}

/**
 * Tira a aba daqui para levar a outro desktop (não vai para "Reabrir aba fechada"). Sem abas,
 * sobra uma Início, como ao fechar a última.
 */
export function takeTab(state: TabsState, id: string): { state: TabsState; tab: Tab } | null {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return null
  const closed = close(state, id)
  return { state: { ...closed, closed: state.closed }, tab }
}

/**
 * Recebe uma aba de outro desktop (com o "Voltar" dela) e a ativa. Um lugar = uma aba: se o lugar
 * já tem aba aqui, ativa a que existe e a que chegou some.
 */
export function adoptTab(state: TabsState, tab: Tab): TabsState {
  const place = placeOf(tab.router.route)
  const existing = place === null ? null : state.tabs.find((t) => placeOf(t.router.route) === place)
  if (existing) return touch({ ...state, overlay: null }, existing.id)
  // Entra no fim da faixa (insertTab põe logo depois da ativa: a última, aqui).
  return insertTab({ ...state, overlay: null, activeId: state.tabs.at(-1)?.id ?? null }, (seq) => ({
    id: `t${seq}`,
    router: tab.router,
    seen: seq
  }))
}

// --- Abas salvas (reabrir o app) -------------------------------------------------------------

export interface SavedTabs {
  routes: Route[]
  active: number
}

/** O que vai para o disco: só a rota atual de cada aba (sem o "Voltar") e qual estava ativa. */
export function serializeTabs(state: TabsState): SavedTabs {
  return {
    routes: state.tabs.map((t) => t.router.route),
    active: Math.max(
      0,
      state.tabs.findIndex((t) => t.id === state.activeId)
    )
  }
}

/** Abas salvas, validadas rota a rota; nada aproveitável = `null`. */
export function parseSavedTabs(value: unknown): SavedTabs | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { routes?: unknown; active?: unknown }
  if (!Array.isArray(v.routes)) return null
  const routes = v.routes
    .slice(0, MAX_TABS)
    .map(parseRoute)
    .filter((r): r is Route => r !== null)
  if (routes.length === 0) return null
  const active = typeof v.active === 'number' && Number.isInteger(v.active) ? v.active : 0
  return { routes, active: Math.min(Math.max(0, active), routes.length - 1) }
}

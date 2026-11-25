/**
 * Rotas do app (6E). Estado tipado no renderer, sem dependência de roteador: cada item do menu é
 * uma rota, e toda navegação gera uma chave nova (clicar no item atual remonta a página e sai de
 * qualquer subtela). Pilha simples para "Voltar".
 */
import { TASK_SECTIONS, type TaskSection, type BoardTaskRef } from '../../../shared/overview'
import { isRecord } from '../../../shared/guards'
import { TASK_FILTERS, type TaskFilter } from '../../../shared/task-lanes'

export const BOARD_LAYOUTS = ['kanban', 'list'] as const
export type BoardLayout = (typeof BOARD_LAYOUTS)[number]

export const SETTINGS_SECTIONS = [
  'general',
  'appearance',
  'layout',
  'notifications',
  'shortcuts',
  'terminal',
  'integrations',
  'projects',
  'providers',
  'board',
  'agents',
  'skills',
  'mcp',
  'secrets',
  'diagnostics',
  'updates',
  'about'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const BOARD_SETTINGS_TABS = [
  'columns',
  'rules',
  'notifications',
  'flows',
  'alva',
  'delivery'
] as const
export type BoardSettingsTab = (typeof BOARD_SETTINGS_TABS)[number]

export type Route =
  /** Primeiros passos; com `projectId`, só os passos que faltam para aquele projeto. */
  | { name: 'setup'; projectId?: string }
  /** Quadro: recorte (um projeto, vários ou todos), visão e filtro. Veja `boardRoute`. */
  | {
      name: 'board'
      projectId?: string
      projectIds?: readonly string[] | 'all'
      view?: BoardLayout
      filter?: TaskFilter
    }
  /** `session`: a sessão do Claude Code que a conversa mostra (lista "Sessões"); sem = a mais recente. */
  | { name: 'task'; projectId: string; taskId: string; section?: TaskSection; session?: string }
  /** Fase 2: terminais da tarefa (pasta de trabalho) e "Continuar no Claude". */
  | {
      name: 'terminal'
      projectId: string
      taskId: string
      /** Ao abrir, já começa o "Continuar no Claude" (paleta/menu). Não volta ao restaurar. */
      start?: 'claude'
    }
  | { name: 'agents' }
  | { name: 'terminals' }
  | { name: 'settings'; section?: SettingsSection; tab?: BoardSettingsTab; projectId?: string }
  /** Aba nova (Fase 0): ponto de partida com as telas e o que espera você. */
  | { name: 'home' }

export type RouteName = Route['name']

export const ROUTE_TITLES: Record<RouteName, string> = {
  setup: 'Primeiros passos',
  board: 'Quadro',
  task: 'Tarefa',
  terminal: 'Terminal',
  agents: 'Agentes',
  terminals: 'Terminais',
  settings: 'Configurações',
  home: 'Nova aba'
}

export const SETTINGS_TITLES: Record<SettingsSection, string> = {
  general: 'Geral',
  appearance: 'Aparência',
  layout: 'Layout',
  notifications: 'Notificações',
  shortcuts: 'Atalhos',
  terminal: 'Terminal',
  integrations: 'Integrações',
  projects: 'Projetos',
  providers: 'Provedores e uso',
  board: 'Quadro e automações',
  agents: 'Agentes do projeto',
  skills: 'Skills',
  mcp: 'Servidores MCP',
  secrets: 'Segredos',
  diagnostics: 'Diagnóstico',
  updates: 'Atualizações',
  about: 'Sobre'
}

type BoardRoute = Extract<Route, { name: 'board' }>

const MAX_BOARD_PROJECTS = 50
const MAX_ID_LENGTH = 200

/**
 * Normaliza a rota do Quadro: sem ids repetidos (até 50, cada um até 200 caracteres), lista vazia
 * some, lista com 1 vira `projectId`, e `projectIds` (2+ ou 'all') tira o `projectId`.
 */
export function boardRoute(input: Omit<BoardRoute, 'name'>): BoardRoute {
  const { view, filter } = input
  let projectId = input.projectId
  let projectIds: readonly string[] | 'all' | undefined
  if (input.projectIds === 'all') projectIds = 'all'
  else if (input.projectIds) {
    const ids = [
      ...new Set(input.projectIds.filter((id) => id.length > 0 && id.length <= MAX_ID_LENGTH))
    ].slice(0, MAX_BOARD_PROJECTS)
    if (ids.length === 1) projectId = ids[0]
    else if (ids.length > 1) projectIds = ids
  }
  if (projectIds) projectId = undefined
  return {
    name: 'board',
    ...(projectId ? { projectId } : {}),
    ...(projectIds ? { projectIds } : {}),
    ...(view ? { view } : {}),
    ...(filter ? { filter } : {})
  }
}

/**
 * Abrir o Quadro "sem nada" (Ctrl/⌘1, dock, tela inicial) em cima de um Quadro mantém o recorte, a
 * visão e o filtro da aba. O `projectId` de uma aba não passa: ele segue o projeto atual do app.
 */
export function boardRouteAsIs(current: Route, next: Route): Route {
  if (
    next.name !== 'board' ||
    current.name !== 'board' ||
    next.projectId !== undefined ||
    next.projectIds !== undefined ||
    next.view !== undefined ||
    next.filter !== undefined
  ) {
    return next
  }
  return boardRoute({
    ...(current.projectIds ? { projectIds: current.projectIds } : {}),
    ...(current.view ? { view: current.view } : {}),
    ...(current.filter ? { filter: current.filter } : {})
  })
}

export function routeForTaskRef(ref: BoardTaskRef): Route {
  return {
    name: 'task',
    projectId: ref.projectId,
    taskId: ref.taskId,
    ...(ref.section ? { section: ref.section } : {})
  }
}

export interface RouterState {
  route: Route
  /** Muda a cada navegação: use como `key` da página. */
  key: number
  history: Route[]
}

export type RouterAction =
  | { type: 'navigate'; route: Route }
  | { type: 'back' }
  /** Troca a tela sem entrar na pilha do "Voltar" (tela inicial decidida ao abrir). */
  | { type: 'reset'; route: Route }
  /** Troca a rota sem remontar a tela nem entrar no "Voltar" (abas: o rascunho não se perde). */
  | { type: 'replace'; route: Route }

const MAX_HISTORY = 30

export function routerReducer(state: RouterState, action: RouterAction): RouterState {
  if (action.type === 'reset') return initialRouter(action.route, state.key + 1)
  if (action.type === 'replace') return { ...state, route: action.route }
  if (action.type === 'back') {
    const previous = state.history.at(-1)
    if (!previous) return state
    return { route: previous, key: state.key + 1, history: state.history.slice(0, -1) }
  }
  return {
    route: action.route,
    key: state.key + 1,
    history: [...state.history, state.route].slice(-MAX_HISTORY)
  }
}

export function initialRouter(route: Route, key = 0): RouterState {
  return { route, key, history: [] }
}

/**
 * Lugar da rota (Fase 0): cada lugar tem no máximo uma aba. Navegar para um lugar que já tem aba
 * ativa essa aba; `null` = nunca divide (cada "Nova aba" é uma). Tela nova com identidade própria
 * (ex.: uma sessão) ganha um caso aqui.
 */
export function placeOf(route: Route): string | null {
  switch (route.name) {
    case 'task':
      return `task:${route.projectId}:${route.taskId}`
    case 'terminal':
      return `terminal:${route.projectId}:${route.taskId}`
    case 'home':
    case 'setup':
      return null
    default:
      return route.name
  }
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200

function pick<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return list.find((x) => x === v)
}

/**
 * Rota salva (abas restauradas ao reabrir o app): só o que o tipo aceita; o resto = `null`.
 * Primeiros passos nunca voltam como aba. A antiga `tasks` vira o Quadro de todos os projetos.
 */
export function parseRoute(v: unknown): Route | null {
  if (!isRecord(v)) return null
  const projectId = str(v['projectId']) ? { projectId: v['projectId'] } : {}
  switch (v['name']) {
    case 'board': {
      const raw = v['projectIds']
      const projectIds = raw === 'all' ? 'all' : Array.isArray(raw) ? raw.filter(str) : undefined
      const view = pick(BOARD_LAYOUTS, v['view'])
      const filter = pick(TASK_FILTERS, v['filter'])
      return boardRoute({
        ...projectId,
        ...(projectIds ? { projectIds } : {}),
        ...(view ? { view } : {}),
        ...(filter ? { filter } : {})
      })
    }
    case 'agents':
      return { name: 'agents' }
    case 'terminals':
      return { name: 'terminals' }
    case 'tasks': {
      // A tela Tarefas saiu: a aba antiga vira o Quadro com todos os projetos e o mesmo filtro.
      const view = pick(BOARD_LAYOUTS, v['view'])
      const filter = pick(TASK_FILTERS, v['filter'])
      return boardRoute({
        projectIds: 'all',
        ...(view ? { view } : {}),
        ...(filter ? { filter } : {})
      })
    }
    case 'home':
      return { name: 'home' }
    case 'task': {
      if (!str(v['projectId']) || !str(v['taskId'])) return null
      const section = pick(TASK_SECTIONS, v['section'])
      return {
        name: 'task',
        projectId: v['projectId'],
        taskId: v['taskId'],
        ...(section ? { section } : {}),
        ...(str(v['session']) ? { session: v['session'] } : {})
      }
    }
    case 'terminal':
      if (!str(v['projectId']) || !str(v['taskId'])) return null
      return { name: 'terminal', projectId: v['projectId'], taskId: v['taskId'] }
    case 'settings': {
      const section = pick(SETTINGS_SECTIONS, v['section'])
      const tab = pick(BOARD_SETTINGS_TABS, v['tab'])
      return {
        name: 'settings',
        ...(section ? { section } : {}),
        ...(tab ? { tab } : {}),
        ...projectId
      }
    }
    default:
      return null
  }
}

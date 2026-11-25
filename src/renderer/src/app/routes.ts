/**
 * Rotas do app (6E). Estado tipado no renderer, sem dependência de roteador: cada item do menu é
 * uma rota, e toda navegação gera uma chave nova (clicar no item atual remonta a página e sai de
 * qualquer subtela). Pilha simples para "Voltar".
 */
import { TASK_SECTIONS, type TaskSection, type BoardTaskRef } from '../../../shared/overview'
import { isRecord } from '../../../shared/guards'
import { TASK_FILTERS, type TaskFilter } from '../../../shared/task-lanes'

export const TASKS_VIEWS = ['kanban', 'list'] as const
export type TasksView = (typeof TASKS_VIEWS)[number]

export const SETTINGS_SECTIONS = [
  'integrations',
  'projects',
  'board',
  'agents',
  'updates',
  'about'
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const BOARD_SETTINGS_TABS = ['columns', 'rules', 'flows', 'delivery'] as const
export type BoardSettingsTab = (typeof BOARD_SETTINGS_TABS)[number]

export type Route =
  /** Primeiros passos; com `projectId`, só os passos que faltam para aquele projeto. */
  | { name: 'setup'; projectId?: string }
  | { name: 'board'; projectId?: string }
  | { name: 'task'; projectId: string; taskId: string; section?: TaskSection }
  | { name: 'agents' }
  /** Fase 1: kanban derivado pessoal (raias calculadas do fluxo e da PR). */
  | { name: 'tasks'; view?: TasksView; filter?: TaskFilter }
  | { name: 'settings'; section?: SettingsSection; tab?: BoardSettingsTab; projectId?: string }
  /** Aba nova (Fase 0): ponto de partida com as telas e o que espera você. */
  | { name: 'home' }

export type RouteName = Route['name']

export const ROUTE_TITLES: Record<RouteName, string> = {
  setup: 'Primeiros passos',
  board: 'Quadro',
  task: 'Tarefa',
  tasks: 'Tarefas',
  agents: 'Agentes',
  settings: 'Configurações',
  home: 'Nova aba'
}

export const SETTINGS_TITLES: Record<SettingsSection, string> = {
  integrations: 'Integrações',
  projects: 'Projetos',
  board: 'Quadro e automações',
  agents: 'Agentes do projeto',
  updates: 'Atualizações',
  about: 'Sobre e diagnóstico'
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
 * Primeiros passos nunca voltam como aba.
 */
export function parseRoute(v: unknown): Route | null {
  if (!isRecord(v)) return null
  const projectId = str(v['projectId']) ? { projectId: v['projectId'] } : {}
  switch (v['name']) {
    case 'board':
      return { name: 'board', ...projectId }
    case 'agents':
      return { name: 'agents' }
    case 'tasks': {
      const view = pick(TASKS_VIEWS, v['view'])
      const filter = pick(TASK_FILTERS, v['filter'])
      return { name: 'tasks', ...(view ? { view } : {}), ...(filter ? { filter } : {}) }
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
        ...(section ? { section } : {})
      }
    }
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

/**
 * Rotas do app (6E). Estado tipado no renderer, sem dependência de roteador: cada item do menu é
 * uma rota, e toda navegação gera uma chave nova (clicar no item atual remonta a página e sai de
 * qualquer subtela). Pilha simples para "Voltar".
 */
import type { TaskSection, BoardTaskRef } from '../../../shared/overview'

/** Seções de Configurações (coluna interna). */
export type SettingsSection = 'integrations' | 'projects' | 'board' | 'agents' | 'updates' | 'about'

/** Abas de Configurações › Quadro e automações. */
export type BoardSettingsTab = 'columns' | 'rules' | 'flows' | 'delivery'

export type Route =
  /** Primeiros passos; com `projectId`, só os passos que faltam para aquele projeto. */
  | { name: 'setup'; projectId?: string }
  | { name: 'board'; projectId?: string }
  /** Tela da tarefa (fases, conversa e painel da fase). */
  | { name: 'task'; projectId: string; taskId: string; section?: TaskSection }
  | { name: 'agents' }
  | { name: 'settings'; section?: SettingsSection; tab?: BoardSettingsTab; projectId?: string }

export type RouteName = Route['name']

/** Títulos das telas (barra superior e Command Palette). */
export const ROUTE_TITLES: Record<RouteName, string> = {
  setup: 'Primeiros passos',
  board: 'Quadro',
  task: 'Tarefa',
  agents: 'Agentes',
  settings: 'Configurações'
}

export const SETTINGS_TITLES: Record<SettingsSection, string> = {
  integrations: 'Integrações',
  projects: 'Projetos',
  board: 'Quadro e automações',
  agents: 'Agentes do projeto',
  updates: 'Atualizações',
  about: 'Sobre e diagnóstico'
}

/** Rota da tela de uma tarefa (notificação, sino, lista lateral, Command Palette). */
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

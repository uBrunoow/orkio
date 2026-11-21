/**
 * Rotas do app (6E). Estado tipado no renderer, sem dependência de roteador: cada item do menu é
 * uma rota, e toda navegação gera uma chave nova (clicar no item atual remonta a página e sai de
 * qualquer subtela). Pilha simples para "Voltar".
 */

/** Telas de um projeto (dependem do projeto atual do menu). */
export type ProjectRouteName = 'board' | 'automations' | 'flows' | 'context'

export type Route =
  | { name: 'welcome' }
  | { name: 'projects' }
  | { name: 'integrations' }
  | { name: 'board'; projectId?: string; taskId?: string }
  | { name: 'automations'; projectId?: string }
  | { name: 'flows'; projectId?: string; tab?: FlowsTab }
  | { name: 'context'; projectId?: string }
  /** Tarefa em tela cheia (o painel lateral do Quadro é a prévia). */
  | { name: 'task'; projectId: string; taskId: string }

export type FlowsTab = 'flows' | 'alva'

export type RouteName = Route['name']

export const PROJECT_ROUTES: readonly ProjectRouteName[] = [
  'board',
  'automations',
  'flows',
  'context'
]

export function isProjectRoute(route: Route): route is Extract<Route, { name: ProjectRouteName }> {
  return (PROJECT_ROUTES as readonly string[]).includes(route.name)
}

/** Títulos das telas (menu, cabeçalho e, depois, a Command Palette). */
export const ROUTE_TITLES: Record<RouteName, string> = {
  welcome: 'Vamos começar',
  projects: 'Projetos',
  integrations: 'Integrações',
  board: 'Quadro',
  automations: 'Etapas e automações',
  flows: 'Fluxos',
  context: 'Contexto do Claude',
  task: 'Tarefa'
}

export interface RouterState {
  route: Route
  /** Muda a cada navegação: use como `key` da página. */
  key: number
  history: Route[]
}

export type RouterAction = { type: 'navigate'; route: Route } | { type: 'back' }

const MAX_HISTORY = 30

export function routerReducer(state: RouterState, action: RouterAction): RouterState {
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

export function initialRouter(route: Route): RouterState {
  return { route, key: 0, history: [] }
}

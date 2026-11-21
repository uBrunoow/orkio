/**
 * Rotas do app (6E). Estado tipado no renderer, sem dependência de roteador: cada item do menu é
 * uma rota, e toda navegação gera uma chave nova (clicar no item atual remonta a página e sai de
 * qualquer subtela). Pilha simples para "Voltar".
 */
import type { TaskSection } from '../../../shared/overview'

/** Telas de um projeto (dependem do projeto atual do menu). */
export type ProjectRouteName = 'board' | 'automations' | 'flows' | 'context'

export type Route =
  | { name: 'welcome' }
  /** Visão geral (6D): o que espera você em todos os projetos. */
  | { name: 'overview' }
  | { name: 'projects' }
  /** Agentes (8A): perfis, revisão e regras por coluna (escolhe o projeto na própria tela). */
  | { name: 'agents' }
  | { name: 'integrations' }
  /** Configurações (6C): Atualizações e Sobre. */
  | { name: 'settings' }
  | { name: 'board'; projectId?: string; taskId?: string; section?: TaskSection }
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
  overview: 'Visão geral',
  projects: 'Projetos',
  agents: 'Agentes',
  integrations: 'Integrações',
  settings: 'Configurações',
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

export type RouterAction =
  | { type: 'navigate'; route: Route }
  | { type: 'back' }
  /** Troca a tela sem entrar na pilha do "Voltar" (tela inicial decidida ao abrir). */
  | { type: 'reset'; route: Route }

const MAX_HISTORY = 30

export function routerReducer(state: RouterState, action: RouterAction): RouterState {
  if (action.type === 'reset') return initialRouter(action.route, state.key + 1)
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

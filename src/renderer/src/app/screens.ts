/**
 * Registro das telas (Fase 0): o dock, o menu "Ir", a paleta, os atalhos e a tela Início leem
 * daqui. Tela nova = uma rota em `routes.ts`, uma entrada aqui e o desenho em `ScreenPages.tsx`
 * (o TypeScript cobra as três).
 */
import {
  AgentsIcon,
  BoardIcon,
  HomeIcon,
  ListIcon,
  SettingsIcon,
  TasksIcon,
  TerminalIcon,
  type SvgIcon
} from '../components/icons'
import {
  ROUTE_TITLES,
  SETTINGS_SECTIONS,
  SETTINGS_TITLES,
  type Route,
  type RouteName,
  type SettingsSection
} from './routes'

export interface ScreenDef {
  name: RouteName
  title: string
  /** Frase curta da tela Início e da paleta. */
  hint: string
  icon: SvgIcon
  /** Rota ao abrir pelo dock/menu (volta ao começo da tela). */
  route: Route
  /** `main` = no alto do dock; `bottom` = no pé do dock; ausente = fora do dock. */
  dock?: 'main' | 'bottom'
  keys?: string
  /** Só faz sentido com um projeto vinculado ao Notion. */
  needsProject?: boolean
}

export const SCREENS: readonly ScreenDef[] = [
  {
    name: 'board',
    title: ROUTE_TITLES.board,
    hint: 'As tarefas do projeto por etapa',
    icon: BoardIcon,
    route: { name: 'board' },
    dock: 'main',
    keys: 'mod+1',
    needsProject: true
  },
  {
    name: 'tasks',
    title: ROUTE_TITLES.tasks,
    hint: 'Em que pé está cada tarefa: precisa de você, trabalhando, em revisão',
    icon: ListIcon,
    route: { name: 'tasks' },
    dock: 'main',
    keys: 'mod+2'
  },
  {
    name: 'agents',
    title: ROUTE_TITLES.agents,
    hint: 'Colegas de IA que pegam tarefas',
    icon: AgentsIcon,
    route: { name: 'agents' },
    dock: 'main',
    keys: 'mod+3'
  },
  {
    name: 'settings',
    title: ROUTE_TITLES.settings,
    hint: 'Integrações, projetos, quadro e atualizações',
    icon: SettingsIcon,
    route: { name: 'settings' },
    dock: 'bottom',
    keys: 'mod+4'
  },
  {
    name: 'task',
    title: ROUTE_TITLES.task,
    hint: 'Uma tarefa do Notion',
    icon: TasksIcon,
    route: { name: 'board' }
  },
  {
    name: 'terminal',
    title: ROUTE_TITLES.terminal,
    hint: 'Terminal na pasta da tarefa',
    icon: TerminalIcon,
    route: { name: 'board' }
  },
  {
    name: 'home',
    title: ROUTE_TITLES.home,
    hint: 'Ponto de partida',
    icon: HomeIcon,
    route: { name: 'home' }
  },
  {
    name: 'setup',
    title: ROUTE_TITLES.setup,
    hint: 'Conectar e configurar o primeiro projeto',
    icon: HomeIcon,
    route: { name: 'setup' }
  }
]

export function screenOf(name: RouteName): ScreenDef {
  return SCREENS.find((s) => s.name === name)!
}

/** Telas do dock, na ordem (alto, depois pé). */
export function dockScreens(where: 'main' | 'bottom'): ScreenDef[] {
  return SCREENS.filter((s) => s.dock === where)
}

/** Seções de Configurações que dependem de um projeto vinculado. */
export function settingsSections(hasProject: boolean): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => hasProject || (s !== 'board' && s !== 'agents'))
}

export { SETTINGS_TITLES }

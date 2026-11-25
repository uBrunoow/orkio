/**
 * Registro único de comandos (Fase 0): os menus da barra (Sessão, Ir, Janela, Ajuda), a paleta
 * (Ctrl/Cmd+K) e os atalhos de teclado leem a mesma lista. Comando novo de uma fase = uma entrada
 * em `APP_COMMANDS` (ou uma tela em `screens.ts`, que vira comando "Ir para" sozinha); o que ele
 * precisa do app entra em `CommandContext`.
 */
import {
  BellIcon,
  CommandIcon,
  GaugeIcon,
  IntegrationsIcon,
  KeyboardIcon,
  NewsIcon,
  PlusIcon,
  RefreshIcon,
  ReopenIcon,
  SearchIcon,
  SidebarIcon,
  SwitchIcon,
  BackIcon,
  CloseIcon,
  TerminalIcon,
  type SvgIcon
} from '../components/icons'
import { matchesKeys, type KeyInput } from './keys'
import { SETTINGS_TITLES, type Route } from './routes'
import { SCREENS, settingsSections } from './screens'
import type { TabsAction } from './tabs'

export type MenuId = 'session' | 'go' | 'window' | 'help'

export const MENUS: readonly { id: MenuId; label: string; palette: string }[] = [
  { id: 'session', label: 'Sessão', palette: 'Ações' },
  { id: 'go', label: 'Ir', palette: 'Ir para' },
  { id: 'window', label: 'Janela', palette: 'Janela' },
  { id: 'help', label: 'Ajuda', palette: 'Ajuda' }
]

export type PaletteMode = 'all' | 'tasks' | 'projects'

/** O que os comandos enxergam do app. */
export interface CommandState {
  isMac: boolean
  route: Route | null
  /** Projeto atual vinculado ao Notion (telas do projeto fazem sentido). */
  hasProject: boolean
  projectCount: number
  tabCount: number
  canBack: boolean
  canReopen: boolean
  sidebarOpen: boolean
  usageMeter: boolean
  waiting: number
  notionConnected: boolean
  githubConnected: boolean
}

/** O que os comandos podem fazer no app. */
export interface CommandActions {
  navigate(route: Route): void
  tabs(action: TabsAction): void
  palette(mode: PaletteMode): void
  toggleSidebar(): void
  setUsageMeter(on: boolean): void
  openWaiting(): void
  refresh(): void
  showShortcuts(): void
  showWhatsNew(): void
  checkUpdates(): void
}

export type CommandContext = CommandState & CommandActions

export interface Command {
  id: string
  /** Texto do menu e da paleta (pode depender do estado: "Esconder"/"Mostrar"). */
  label: string | ((ctx: CommandState) => string)
  /** Menu da barra; ausente = só na paleta (e no atalho, se tiver). */
  menu?: MenuId
  /** Bloco dentro do menu: blocos diferentes ganham um separador entre eles. */
  block?: number
  icon?: SvgIcon
  /** Atalho mostrado (formato de `keys.ts`). */
  keys?: string
  /** Outros atalhos que também disparam (não aparecem). */
  altKeys?: readonly string[]
  /** Palavras a mais para a busca da paleta. */
  keywords?: readonly string[]
  /** `false` = fora da paleta (ex.: abrir a própria paleta). */
  inPalette?: boolean
  /** Aparece agora? (ex.: "Conectar o Notion" só sem conexão). */
  visible?(ctx: CommandState): boolean
  /** Pode rodar agora? Desabilitado no menu; fora da paleta; atalho ignorado. */
  enabled?(ctx: CommandState): boolean
  run(ctx: CommandContext): void
}

export function commandLabel(command: Command, ctx: CommandState): string {
  return typeof command.label === 'function' ? command.label(ctx) : command.label
}

export function isAvailable(command: Command, ctx: CommandState): boolean {
  return (command.visible?.(ctx) ?? true) && (command.enabled?.(ctx) ?? true)
}

/** A tarefa da tela atual (tela da tarefa ou o terminal dela), ou `null`. */
export function taskOf(route: Route | null): { projectId: string; taskId: string } | null {
  return route && (route.name === 'task' || route.name === 'terminal')
    ? { projectId: route.projectId, taskId: route.taskId }
    : null
}

/** "Ir para" de cada tela do dock (Quadro, Agentes, Configurações). */
function screenCommands(): Command[] {
  return SCREENS.filter((s) => s.dock).map((s) => ({
    id: `go:${s.name}`,
    label: s.title,
    menu: 'go' as const,
    block: 0,
    icon: s.icon,
    ...(s.keys ? { keys: s.keys } : {}),
    keywords: [s.hint],
    ...(s.needsProject ? { visible: (ctx: CommandState) => ctx.hasProject } : {}),
    run: (ctx: CommandContext) => ctx.navigate(s.route)
  }))
}

/** Seções de Configurações (só na paleta: o menu "Ir" fica curto). */
function settingsCommands(): Command[] {
  const all = settingsSections(true).map((section): Command => ({
    id: `go:settings:${section}`,
    label: SETTINGS_TITLES[section],
    keywords: ['configurações'],
    visible: (ctx) => settingsSections(ctx.hasProject).includes(section),
    run: (ctx) => ctx.navigate({ name: 'settings', section })
  }))
  all.push({
    id: 'go:settings:board:flows',
    label: 'Modelos do alva-flow',
    visible: (ctx) => ctx.hasProject,
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'board', tab: 'flows' })
  })
  return all
}

export const APP_COMMANDS: readonly Command[] = [
  // Sessão
  {
    id: 'palette',
    label: 'Paleta de comandos…',
    menu: 'session',
    block: 0,
    icon: CommandIcon,
    keys: 'mod+k',
    altKeys: ['?'],
    inPalette: false,
    run: (ctx) => ctx.palette('all')
  },
  {
    id: 'search-task',
    label: 'Buscar tarefa no Notion…',
    menu: 'session',
    block: 0,
    icon: SearchIcon,
    keys: 'mod+p',
    inPalette: false,
    run: (ctx) => ctx.palette('tasks')
  },
  {
    id: 'switch-project',
    label: 'Trocar de projeto…',
    menu: 'session',
    block: 0,
    icon: SwitchIcon,
    keys: 'mod+shift+o',
    inPalette: false,
    enabled: (ctx) => ctx.projectCount > 1,
    run: (ctx) => ctx.palette('projects')
  },
  {
    id: 'open-waiting',
    label: 'Abrir o que espera você',
    menu: 'session',
    block: 1,
    icon: BellIcon,
    keys: 'mod+shift+e',
    keywords: ['esperando', 'aprovar', 'pendente', 'sino'],
    enabled: (ctx) => ctx.waiting > 0,
    run: (ctx) => ctx.openWaiting()
  },
  {
    id: 'task:terminal',
    label: 'Abrir o terminal da tarefa',
    menu: 'session',
    block: 1,
    icon: TerminalIcon,
    keys: 'mod+shift+j',
    keywords: ['terminal', 'shell', 'console', 'worktree'],
    visible: (ctx) => taskOf(ctx.route) !== null,
    run: (ctx) => {
      const task = taskOf(ctx.route)
      if (task) ctx.navigate({ name: 'terminal', ...task })
    }
  },
  {
    id: 'task:continue-in-claude',
    label: 'Continuar no Claude',
    menu: 'session',
    block: 1,
    icon: TerminalIcon,
    keywords: ['claude', 'terminal', 'resume', 'assumir', 'permissão', 'na mão'],
    visible: (ctx) => taskOf(ctx.route) !== null,
    run: (ctx) => {
      const task = taskOf(ctx.route)
      if (task) ctx.navigate({ name: 'terminal', ...task, start: 'claude' })
    }
  },
  {
    id: 'refresh',
    label: 'Verificar agora (git, GitHub e Notion)',
    menu: 'session',
    block: 1,
    icon: RefreshIcon,
    keywords: ['atualizar', 'sincronizar'],
    run: (ctx) => ctx.refresh()
  },
  {
    id: 'connect-notion',
    label: 'Conectar o Notion',
    menu: 'session',
    block: 2,
    icon: IntegrationsIcon,
    visible: (ctx) => !ctx.notionConnected,
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'integrations' })
  },
  {
    id: 'connect-github',
    label: 'Conectar o GitHub',
    menu: 'session',
    block: 2,
    icon: IntegrationsIcon,
    visible: (ctx) => !ctx.githubConnected,
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'integrations' })
  },
  // Ir
  ...screenCommands(),
  {
    id: 'go:setup',
    label: 'Primeiros passos',
    menu: 'go',
    block: 1,
    keywords: ['configurar', 'começar'],
    run: (ctx) => ctx.navigate({ name: 'setup' })
  },
  {
    id: 'back',
    label: 'Voltar',
    menu: 'go',
    block: 2,
    icon: BackIcon,
    keys: 'mod+[',
    altKeys: ['alt+arrowleft'],
    inPalette: false,
    enabled: (ctx) => ctx.canBack,
    run: (ctx) => ctx.tabs({ type: 'back' })
  },
  ...settingsCommands(),
  // Janela
  {
    id: 'tab:new',
    label: 'Nova aba',
    menu: 'window',
    block: 0,
    icon: PlusIcon,
    keys: 'mod+t',
    run: (ctx) => ctx.tabs({ type: 'open' })
  },
  {
    id: 'tab:close',
    label: 'Fechar aba',
    menu: 'window',
    block: 0,
    icon: CloseIcon,
    keys: 'mod+w',
    enabled: (ctx) => ctx.tabCount > 0,
    run: (ctx) => ctx.tabs({ type: 'close' })
  },
  {
    id: 'tab:reopen',
    label: 'Reabrir aba fechada',
    menu: 'window',
    block: 0,
    icon: ReopenIcon,
    keys: 'mod+shift+t',
    enabled: (ctx) => ctx.canReopen,
    run: (ctx) => ctx.tabs({ type: 'reopen' })
  },
  {
    id: 'tab:next',
    label: 'Próxima aba',
    menu: 'window',
    block: 1,
    keys: 'ctrl+tab',
    enabled: (ctx) => ctx.tabCount > 1,
    run: (ctx) => ctx.tabs({ type: 'cycle', offset: 1 })
  },
  {
    id: 'tab:previous',
    label: 'Aba anterior',
    menu: 'window',
    block: 1,
    keys: 'ctrl+shift+tab',
    enabled: (ctx) => ctx.tabCount > 1,
    run: (ctx) => ctx.tabs({ type: 'cycle', offset: -1 })
  },
  {
    id: 'tab:left',
    label: 'Mover aba para a esquerda',
    menu: 'window',
    block: 1,
    keys: 'mod+shift+pageup',
    enabled: (ctx) => ctx.tabCount > 1,
    run: (ctx) => ctx.tabs({ type: 'shift', offset: -1 })
  },
  {
    id: 'tab:right',
    label: 'Mover aba para a direita',
    menu: 'window',
    block: 1,
    keys: 'mod+shift+pagedown',
    enabled: (ctx) => ctx.tabCount > 1,
    run: (ctx) => ctx.tabs({ type: 'shift', offset: 1 })
  },
  {
    id: 'sidebar',
    label: (ctx) => (ctx.sidebarOpen ? 'Esconder lista de tarefas' : 'Mostrar lista de tarefas'),
    menu: 'window',
    block: 2,
    icon: SidebarIcon,
    keys: 'mod+b',
    keywords: ['lateral', 'coluna'],
    run: (ctx) => ctx.toggleSidebar()
  },
  {
    id: 'usage-meter',
    label: (ctx) =>
      ctx.usageMeter ? 'Esconder o uso do Claude na barra' : 'Mostrar o uso do Claude na barra',
    menu: 'window',
    block: 2,
    icon: GaugeIcon,
    keywords: ['medidor', 'limite', 'cota'],
    run: (ctx) => ctx.setUsageMeter(!ctx.usageMeter)
  },
  // Ajuda
  {
    id: 'shortcuts',
    label: 'Atalhos do teclado',
    menu: 'help',
    block: 0,
    icon: KeyboardIcon,
    keys: 'mod+/',
    run: (ctx) => ctx.showShortcuts()
  },
  {
    id: 'whats-new',
    label: 'O que há de novo',
    menu: 'help',
    block: 0,
    icon: NewsIcon,
    keywords: ['novidades', 'versão'],
    run: (ctx) => ctx.showWhatsNew()
  },
  {
    id: 'check-updates',
    label: 'Procurar atualizações',
    menu: 'help',
    block: 1,
    keywords: ['atualizar'],
    run: (ctx) => ctx.checkUpdates()
  },
  {
    id: 'about',
    label: 'Sobre e diagnóstico',
    menu: 'help',
    block: 1,
    keywords: ['versão', 'diagnóstico'],
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'about' })
  }
]

/** Comandos de um menu, já em blocos (separadores entre eles). Escondidos ficam de fora. */
export function menuBlocks(
  commands: readonly Command[],
  menu: MenuId,
  ctx: CommandState
): Command[][] {
  const blocks = new Map<number, Command[]>()
  for (const c of commands) {
    if (c.menu !== menu || !(c.visible?.(ctx) ?? true)) continue
    const b = c.block ?? 0
    blocks.set(b, [...(blocks.get(b) ?? []), c])
  }
  return [...blocks.entries()].sort(([a], [b]) => a - b).map(([, list]) => list)
}

/** O comando que a tecla dispara (o primeiro disponível que bate), ou `null`. */
export function commandForKey(
  commands: readonly Command[],
  e: KeyInput,
  ctx: CommandState
): Command | null {
  for (const c of commands) {
    const keys = [...(c.keys ? [c.keys] : []), ...(c.altKeys ?? [])]
    if (keys.some((k) => matchesKeys(k, e, ctx.isMac)) && isAvailable(c, ctx)) return c
  }
  return null
}

/** Comandos que vão para a paleta agora (disponíveis e não escondidos dela). */
export function paletteCommands(commands: readonly Command[], ctx: CommandState): Command[] {
  return commands.filter((c) => c.inPalette !== false && isAvailable(c, ctx))
}

export function paletteGroup(command: Command): string {
  return MENUS.find((m) => m.id === command.menu)?.palette ?? 'Ir para'
}

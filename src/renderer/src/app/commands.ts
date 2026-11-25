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
  BoardIcon,
  CloseIcon,
  TerminalIcon,
  GridIcon,
  TabIcon,
  type SvgIcon
} from '../components/icons'
import { ARRANGEMENTS, MAX_DESKTOPS, type Arrangement, type DesktopsAction } from './desktops'
import { formatKeys, matchesKeys, type KeyInput } from './keys'
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
  /** Desktops (Fase 5); ausente = um desktop só, sem divisão (ex.: listas de atalhos). */
  desktops?: DesktopsInfo
}

export interface DesktopsInfo {
  list: readonly { id: string; name: string }[]
  /** Posição do desktop atual em `list`. */
  index: number
  arrangement: Arrangement
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
  desktop(action: DesktopsAction): void
  /** Abre a lista de todos os desktops (o seletor da faixa de abas). */
  showDesktops(): void
  renameDesktop(): void
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
  /**
   * Como aparece nas listas de atalhos (Ajuda › Atalhos): `false` = não aparece (ex.: os
   * "Ir para o desktop 2…9", resumidos numa linha só pelo primeiro).
   */
  shortcutRow?: false | { label: string; keys: string; suffix?: string }
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

/**
 * Quadro de todos os projetos (Ctrl/⌘2; antes era a tela Tarefas). A rota tem recorte, então
 * `boardRouteAsIs` não a muda: numa aba de Quadro, troca o recorte dela.
 */
const BOARD_ALL: Command = {
  id: 'go:board:all',
  label: 'Quadro de todos os projetos',
  menu: 'go',
  block: 0,
  icon: BoardIcon,
  keys: 'mod+2',
  keywords: ['tarefas', 'todos os projetos'],
  visible: (ctx) => ctx.hasProject,
  run: (ctx) => ctx.navigate({ name: 'board', projectIds: 'all' })
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
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'board', tab: 'alva' })
  })
  return all
}

const desktopCount = (ctx: CommandState): number => ctx.desktops?.list.length ?? 1
const desktopAt = (ctx: CommandState, i: number): { id: string; name: string } | null =>
  ctx.desktops?.list[i] ?? null

/** Desktops e arranjos (Fase 5), no menu Janela e na paleta. */
function desktopCommands(): Command[] {
  const goTo = Array.from({ length: MAX_DESKTOPS }, (_, i): Command => ({
    id: `desktop:go:${i + 1}`,
    label: (ctx) => `Ir para ${desktopAt(ctx, i)?.name ?? `Desktop ${i + 1}`}`,
    keys: `mod+alt+${i + 1}`,
    shortcutRow:
      i === 0
        ? {
            label: `Ir para o desktop 1 a ${MAX_DESKTOPS}`,
            keys: 'mod+alt+1',
            suffix: `–${MAX_DESKTOPS}`
          }
        : false,
    keywords: ['desktop', 'área de trabalho', 'trocar'],
    visible: (ctx) => desktopAt(ctx, i) !== null,
    enabled: (ctx) => (ctx.desktops?.index ?? 0) !== i,
    run: (ctx) => {
      const d = desktopAt(ctx, i)
      if (d) ctx.desktop({ type: 'switch', id: d.id })
    }
  }))
  const moveTo = Array.from({ length: MAX_DESKTOPS }, (_, i): Command => ({
    id: `desktop:move-tab:${i + 1}`,
    label: (ctx) => `Mover aba para ${desktopAt(ctx, i)?.name ?? `Desktop ${i + 1}`}`,
    keywords: ['desktop', 'levar', 'aba'],
    visible: (ctx) => desktopAt(ctx, i) !== null && (ctx.desktops?.index ?? 0) !== i,
    enabled: (ctx) => ctx.tabCount > 0,
    run: (ctx) => {
      const d = desktopAt(ctx, i)
      if (d) ctx.desktop({ type: 'move-tab', to: d.id })
    }
  }))
  const arrange = ARRANGEMENTS.map((a): Command => ({
    id: `layout:${a.id}`,
    label: `Arranjo: ${a.label}`,
    menu: 'window',
    block: 5,
    ...(a.id === 'grid' ? { icon: GridIcon } : {}),
    keywords: ['dividir', 'lado a lado', 'divisão', 'layout', a.hint],
    enabled: (ctx) => (ctx.desktops?.arrangement ?? 'single') !== a.id,
    run: (ctx) => ctx.desktop({ type: 'arrange', arrangement: a.id })
  }))
  return [
    {
      id: 'desktop:all',
      label: 'Todos os desktops…',
      menu: 'window',
      block: 3,
      icon: TabIcon,
      keys: 'mod+shift+d',
      keywords: ['desktop', 'área de trabalho', 'trocar'],
      run: (ctx) => ctx.showDesktops()
    },
    {
      id: 'desktop:new',
      label: 'Novo desktop',
      menu: 'window',
      block: 3,
      icon: PlusIcon,
      keys: 'mod+alt+n',
      keywords: ['desktop', 'área de trabalho', 'criar'],
      enabled: (ctx) => desktopCount(ctx) < MAX_DESKTOPS,
      run: (ctx) => ctx.desktop({ type: 'create' })
    },
    {
      id: 'desktop:next',
      label: 'Próximo desktop',
      menu: 'window',
      block: 3,
      keys: 'mod+alt+arrowright',
      keywords: ['desktop'],
      enabled: (ctx) => desktopCount(ctx) > 1,
      run: (ctx) => ctx.desktop({ type: 'cycle', offset: 1 })
    },
    {
      id: 'desktop:previous',
      label: 'Desktop anterior',
      menu: 'window',
      block: 3,
      keys: 'mod+alt+arrowleft',
      keywords: ['desktop'],
      enabled: (ctx) => desktopCount(ctx) > 1,
      run: (ctx) => ctx.desktop({ type: 'cycle', offset: -1 })
    },
    {
      id: 'desktop:move-tab:new',
      label: 'Mover aba para um novo desktop',
      menu: 'window',
      block: 3,
      keywords: ['desktop', 'levar', 'aba'],
      enabled: (ctx) => ctx.tabCount > 0 && desktopCount(ctx) < MAX_DESKTOPS,
      run: (ctx) => ctx.desktop({ type: 'move-tab', to: 'new' })
    },
    {
      id: 'desktop:rename',
      label: 'Renomear desktop…',
      keywords: ['desktop', 'nome'],
      run: (ctx) => ctx.renameDesktop()
    },
    {
      id: 'desktop:remove',
      label: 'Apagar desktop',
      keywords: ['desktop', 'fechar', 'remover'],
      enabled: (ctx) => desktopCount(ctx) > 1,
      run: (ctx) => ctx.desktop({ type: 'remove' })
    },
    ...goTo,
    ...moveTo,
    ...arrange
  ]
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
  // O Quadro de todos os projetos fica logo depois do Quadro no menu "Ir".
  ...screenCommands().flatMap((c) => (c.id === 'go:board' ? [c, BOARD_ALL] : [c])),
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
  ...desktopCommands(),
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
    label: 'Sobre o Orkio',
    menu: 'help',
    block: 1,
    keywords: ['versão'],
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'about' })
  },
  {
    id: 'diagnostics',
    label: 'Diagnóstico',
    menu: 'help',
    block: 1,
    keywords: ['diagnóstico', 'logs', 'armazenamento', 'conferir'],
    run: (ctx) => ctx.navigate({ name: 'settings', section: 'diagnostics' })
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

/**
 * Linhas da lista de atalhos de um menu (Ajuda › Atalhos): todo comando com atalho, menos os
 * resumidos (`shortcutRow: false`); "Ir para o desktop 1 a 9" vira uma linha com "Ctrl Alt 1–9".
 */
export function shortcutRows(
  commands: readonly Command[],
  menu: MenuId,
  ctx: CommandState
): { id: string; label: string; keys: string }[] {
  return commands
    .filter((c) => c.keys && (c.menu ?? 'go') === menu && c.shortcutRow !== false)
    .map((c) =>
      c.shortcutRow
        ? {
            id: c.id,
            label: c.shortcutRow.label,
            keys: `${formatKeys(c.shortcutRow.keys, ctx.isMac)}${c.shortcutRow.suffix ?? ''}`
          }
        : { id: c.id, label: commandLabel(c, ctx), keys: formatKeys(c.keys!, ctx.isMac) }
    )
}

/** Comandos que vão para a paleta agora (disponíveis e não escondidos dela). */
export function paletteCommands(commands: readonly Command[], ctx: CommandState): Command[] {
  return commands.filter((c) => c.inPalette !== false && isAvailable(c, ctx))
}

export function paletteGroup(command: Command): string {
  return MENUS.find((m) => m.id === command.menu)?.palette ?? 'Ir para'
}

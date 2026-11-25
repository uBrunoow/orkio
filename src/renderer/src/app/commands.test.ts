import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  APP_COMMANDS,
  MENUS,
  commandForKey,
  commandLabel,
  menuBlocks,
  paletteCommands,
  shortcutRows,
  type CommandActions,
  type CommandContext,
  type CommandState
} from './commands'
import { ariaKeys, formatKeys, matchesKeys, type KeyInput } from './keys'

const state = (over: Partial<CommandState> = {}): CommandState => ({
  isMac: false,
  route: { name: 'board' },
  hasProject: true,
  projectCount: 2,
  tabCount: 2,
  canBack: true,
  canReopen: false,
  sidebarOpen: true,
  usageMeter: true,
  waiting: 0,
  notionConnected: true,
  githubConnected: true,
  ...over
})

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  inTextField: false,
  ...extra
})

type Mocked = CommandState & { [K in keyof CommandActions]: Mock<CommandActions[K]> }

function context(over: Partial<CommandState> = {}): Mocked {
  return {
    ...state(over),
    navigate: vi.fn(),
    tabs: vi.fn(),
    palette: vi.fn(),
    toggleSidebar: vi.fn(),
    setUsageMeter: vi.fn(),
    openWaiting: vi.fn(),
    refresh: vi.fn(),
    showShortcuts: vi.fn(),
    showWhatsNew: vi.fn(),
    checkUpdates: vi.fn(),
    desktop: vi.fn(),
    showDesktops: vi.fn(),
    renameDesktop: vi.fn()
  }
}

const fire = (e: KeyInput, over: Partial<CommandState> = {}) => {
  const ctx = context(over)
  const command = commandForKey(APP_COMMANDS, e, ctx)
  command?.run(ctx as CommandContext)
  return { command, ctx }
}

describe('teclas', () => {
  it('mod = Ctrl fora do Mac, ⌘ no Mac', () => {
    expect(matchesKeys('mod+k', key('k', { ctrlKey: true }), false)).toBe(true)
    expect(matchesKeys('mod+k', key('k', { metaKey: true }), true)).toBe(true)
    expect(matchesKeys('mod+k', key('k', { metaKey: true }), false)).toBe(false)
    expect(matchesKeys('mod+k', key('K', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(matchesKeys('mod+shift+t', key('T', { ctrlKey: true, shiftKey: true }), false)).toBe(
      true
    )
  })
  it('sem modificador nunca dispara dentro de um campo de texto', () => {
    expect(matchesKeys('?', key('?', { shiftKey: true }), false)).toBe(true)
    expect(matchesKeys('?', key('?', { shiftKey: true, inTextField: true }), false)).toBe(false)
    expect(matchesKeys('alt+arrowleft', key('ArrowLeft', { altKey: true }), false)).toBe(true)
  })
  it('texto e aria do atalho', () => {
    expect(formatKeys('mod+shift+t', false)).toBe('Ctrl Shift T')
    expect(formatKeys('mod+shift+t', true)).toBe('⌘ ⇧ T')
    expect(formatKeys('ctrl+tab', true)).toBe('⌃ Tab')
    expect(ariaKeys('mod+1', false)).toBe('Control+1')
    expect(ariaKeys('mod+k', true)).toBe('Meta+K')
  })
})

describe('registro de comandos', () => {
  it('ids únicos e todo menu tem comandos', () => {
    const ids = APP_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of MENUS)
      expect(menuBlocks(APP_COMMANDS, m.id, state()).flat().length).toBeGreaterThan(0)
  })

  it('um atalho = um comando (sem colisões)', () => {
    const keys = APP_COMMANDS.flatMap((c) => [...(c.keys ? [c.keys] : []), ...(c.altKeys ?? [])])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('Ctrl+número: Quadro, Quadro de todos os projetos, Agentes, Configurações, Terminais; Ctrl+6 nada', () => {
    const go = (n: string) => fire(key(n, { ctrlKey: true })).ctx.navigate.mock.calls[0]?.[0]
    expect(go('1')).toEqual({ name: 'board' })
    expect(go('2')).toEqual({ name: 'board', projectIds: 'all' })
    expect(go('3')).toEqual({ name: 'agents' })
    expect(go('4')).toEqual({ name: 'settings' })
    expect(go('5')).toEqual({ name: 'terminals' })
    expect(fire(key('6', { ctrlKey: true })).command).toBeNull()
  })

  it('Ctrl+K abre a paleta mesmo num campo; "?" só fora dele', () => {
    expect(fire(key('k', { ctrlKey: true, inTextField: true })).ctx.palette).toHaveBeenCalledWith(
      'all'
    )
    expect(fire(key('?', { shiftKey: true })).command?.id).toBe('palette')
    expect(fire(key('?', { shiftKey: true, inTextField: true })).command).toBeNull()
  })

  it('abas pelo teclado: nova, fechar, reabrir, próxima, mover', () => {
    expect(fire(key('t', { ctrlKey: true })).ctx.tabs).toHaveBeenCalledWith({ type: 'open' })
    expect(fire(key('w', { ctrlKey: true })).ctx.tabs).toHaveBeenCalledWith({ type: 'close' })
    expect(fire(key('T', { ctrlKey: true, shiftKey: true })).command).toBeNull() // nada a reabrir
    expect(
      fire(key('T', { ctrlKey: true, shiftKey: true }), { canReopen: true }).ctx.tabs
    ).toHaveBeenCalledWith({ type: 'reopen' })
    expect(fire(key('Tab', { ctrlKey: true })).ctx.tabs).toHaveBeenCalledWith({
      type: 'cycle',
      offset: 1
    })
    expect(fire(key('Tab', { ctrlKey: true }), { isMac: true }).command?.id).toBe('tab:next')
    expect(fire(key('PageDown', { ctrlKey: true, shiftKey: true })).ctx.tabs).toHaveBeenCalledWith({
      type: 'shift',
      offset: 1
    })
  })

  it('desktops: Ctrl+Alt+número vai ao desktop; Ctrl+Alt+←/→ anda; sem o desktop, nada', () => {
    const desktops = {
      list: [
        { id: 'd1', name: 'Desktop 1' },
        { id: 'd2', name: 'Orkio' }
      ],
      index: 0,
      arrangement: 'single' as const
    }
    expect(
      fire(key('2', { ctrlKey: true, altKey: true }), { desktops }).ctx.desktop
    ).toHaveBeenCalledWith({ type: 'switch', id: 'd2' })
    // Ctrl+2 continua sendo o Quadro de todos os projetos (Alt faz diferença).
    expect(fire(key('2', { ctrlKey: true }), { desktops }).command?.id).toBe('go:board:all')
    expect(fire(key('3', { ctrlKey: true, altKey: true }), { desktops }).command).toBeNull()
    expect(fire(key('1', { ctrlKey: true, altKey: true }), { desktops }).command).toBeNull() // já está
    expect(
      fire(key('ArrowRight', { ctrlKey: true, altKey: true }), { desktops }).ctx.desktop
    ).toHaveBeenCalledWith({ type: 'cycle', offset: 1 })
    expect(fire(key('ArrowLeft', { ctrlKey: true, altKey: true })).command).toBeNull() // um só
    expect(fire(key('D', { ctrlKey: true, shiftKey: true })).ctx.showDesktops).toHaveBeenCalled()
    expect(fire(key('n', { ctrlKey: true, altKey: true })).ctx.desktop).toHaveBeenCalledWith({
      type: 'create'
    })
    expect(
      commandLabel(
        APP_COMMANDS.find((c) => c.id === 'desktop:go:2')!,
        state({ desktops })
      )
    ).toBe('Ir para Orkio')
    const ids = paletteCommands(APP_COMMANDS, state({ desktops })).map((c) => c.id)
    expect(ids).toContain('desktop:move-tab:2')
    expect(ids).not.toContain('desktop:move-tab:1') // o atual
    expect(ids).not.toContain('layout:single') // o arranjo atual
    expect(ids).toContain('layout:columns')
  })

  it('Ajuda › Atalhos: os desktops 1 a 9 numa linha só', () => {
    const rows = shortcutRows(APP_COMMANDS, 'go', state())
    const desk = rows.filter((r) => r.id.startsWith('desktop:go:'))
    expect(desk).toEqual([
      { id: 'desktop:go:1', label: 'Ir para o desktop 1 a 9', keys: 'Ctrl Alt 1–9' }
    ])
  })

  it('Voltar: Ctrl+[ e Alt+← (fora de campos), só com histórico', () => {
    expect(fire(key('[', { ctrlKey: true })).ctx.tabs).toHaveBeenCalledWith({ type: 'back' })
    expect(fire(key('ArrowLeft', { altKey: true })).command?.id).toBe('back')
    expect(fire(key('ArrowLeft', { altKey: true, inTextField: true })).command).toBeNull()
    expect(fire(key('[', { ctrlKey: true }), { canBack: false }).command).toBeNull()
  })

  it('estado muda o texto e o que aparece', () => {
    const sidebar = APP_COMMANDS.find((c) => c.id === 'sidebar')!
    expect(commandLabel(sidebar, state())).toBe('Esconder lista de tarefas')
    expect(commandLabel(sidebar, state({ sidebarOpen: false }))).toBe('Mostrar lista de tarefas')
    const ids = (s: CommandState) => paletteCommands(APP_COMMANDS, s).map((c) => c.id)
    expect(ids(state())).not.toContain('connect-notion')
    expect(ids(state({ notionConnected: false }))).toContain('connect-notion')
    expect(ids(state({ hasProject: false }))).not.toContain('go:board')
    expect(ids(state({ hasProject: false }))).not.toContain('go:board:all')
    expect(ids(state({ hasProject: false }))).not.toContain('go:settings:board')
    expect(ids(state())).not.toContain('palette') // a paleta não lista a si mesma
    expect(ids(state({ waiting: 2 }))).toContain('open-waiting')
  })
})

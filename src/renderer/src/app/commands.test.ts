import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  APP_COMMANDS,
  MENUS,
  commandForKey,
  commandLabel,
  menuBlocks,
  paletteCommands,
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
    checkUpdates: vi.fn()
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

  it('Ctrl+número segue o dock: Quadro, Tarefas, Agentes, Configurações; Ctrl+5 não faz nada', () => {
    const go = (n: string) => fire(key(n, { ctrlKey: true })).ctx.navigate.mock.calls[0]?.[0]
    expect(go('1')).toEqual({ name: 'board' })
    expect(go('2')).toEqual({ name: 'tasks' })
    expect(go('3')).toEqual({ name: 'agents' })
    expect(go('4')).toEqual({ name: 'settings' })
    expect(fire(key('5', { ctrlKey: true })).command).toBeNull()
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
    expect(ids(state({ hasProject: false }))).not.toContain('go:settings:board')
    expect(ids(state())).not.toContain('palette') // a paleta não lista a si mesma
    expect(ids(state({ waiting: 2 }))).toContain('open-waiting')
  })
})

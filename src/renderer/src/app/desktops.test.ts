import { describe, expect, it } from 'vitest'
import {
  EMPTY_DESKTOPS,
  MAX_DESKTOPS,
  activeDesktop,
  desktopsReducer,
  loadSavedDesktops,
  nextDesktopName,
  parseSavedDesktops,
  serializeDesktops,
  visiblePanels,
  type DesktopsAction,
  type DesktopsState
} from './desktops'
import { adoptTab, currentRoute, takeTab, tabsReducer, visibleTabs, EMPTY_TABS } from './tabs'
import type { Route } from './routes'

const run = (...actions: DesktopsAction[]): DesktopsState =>
  actions.reduce(desktopsReducer, EMPTY_DESKTOPS)
const nav = (route: Route): DesktopsAction => ({
  type: 'tabs',
  action: { type: 'navigate', route }
})
const task = (taskId: string): Route => ({ name: 'task', projectId: 'p1', taskId })
const routesOf = (s: DesktopsState, i: number): Route[] =>
  s.desktops[i]!.tabs.tabs.map((t) => t.router.route)

describe('desktops', () => {
  it('cada desktop tem as próprias abas; criar abre uma Início e troca para ele', () => {
    let s = run(nav({ name: 'board' }), nav(task('a')))
    s = desktopsReducer(s, { type: 'create' })
    expect(s.desktops.map((d) => d.name)).toEqual(['Desktop 1', 'Desktop 2'])
    expect(activeDesktop(s).name).toBe('Desktop 2')
    expect(currentRoute(activeDesktop(s).tabs)).toEqual({ name: 'home' })
    s = desktopsReducer(s, nav({ name: 'agents' }))
    expect(routesOf(s, 0)).toEqual([{ name: 'board' }, task('a')])
    expect(routesOf(s, 1)).toEqual([{ name: 'agents' }])
    // Um lugar = uma aba vale por desktop: o Quadro pode estar nos dois.
    s = desktopsReducer(s, nav({ name: 'board' }))
    expect(routesOf(s, 1)).toEqual([{ name: 'agents' }, { name: 'board' }])
  })

  it('trocar, andar em volta, renomear, apagar (o último não)', () => {
    let s = run({ type: 'create' }, { type: 'create' })
    expect(s.desktops).toHaveLength(3)
    s = desktopsReducer(s, { type: 'cycle', offset: 1 })
    expect(activeDesktop(s).name).toBe('Desktop 1')
    s = desktopsReducer(s, { type: 'cycle', offset: -1 })
    expect(activeDesktop(s).name).toBe('Desktop 3')
    s = desktopsReducer(s, { type: 'rename', name: '  Projeto   X  ' })
    expect(activeDesktop(s).name).toBe('Projeto X')
    expect(desktopsReducer(s, { type: 'rename', name: '   ' })).toBe(s)
    s = desktopsReducer(s, { type: 'switch', id: s.desktops[0]!.id })
    s = desktopsReducer(s, { type: 'remove' })
    expect(s.desktops.map((d) => d.name)).toEqual(['Desktop 2', 'Projeto X'])
    expect(activeDesktop(s).name).toBe('Desktop 2')
    s = desktopsReducer(s, { type: 'remove' })
    expect(desktopsReducer(s, { type: 'remove' })).toBe(s)
    expect(nextDesktopName(s.desktops)).toBe('Desktop 1')
  })

  it('apagar leva as abas para "Reabrir aba fechada" do vizinho', () => {
    let s = run(nav({ name: 'board' }), { type: 'create' }, nav(task('a')))
    s = desktopsReducer(s, { type: 'remove' })
    expect(activeDesktop(s).tabs.closed).toEqual([task('a')])
  })

  it(`no máximo ${MAX_DESKTOPS} desktops`, () => {
    const s = run(...Array.from({ length: 12 }, (): DesktopsAction => ({ type: 'create' })))
    expect(s.desktops).toHaveLength(MAX_DESKTOPS)
  })

  it('mover a aba: vai com o "Voltar"; a origem sem abas fica com uma Início', () => {
    let s = run(nav({ name: 'settings' }), nav({ name: 'settings', section: 'mcp' }))
    s = desktopsReducer(s, { type: 'create' })
    const target = activeDesktop(s).id
    s = desktopsReducer(s, { type: 'switch', id: s.desktops[0]!.id })
    s = desktopsReducer(s, { type: 'move-tab', to: target })
    expect(routesOf(s, 0)).toEqual([{ name: 'home' }])
    expect(activeDesktop(s).id).toBe(s.desktops[0]!.id) // fica onde estava
    const moved = s.desktops[1]!.tabs
    expect(currentRoute(moved)).toEqual({ name: 'settings', section: 'mcp' })
    expect(moved.tabs.find((t) => t.id === moved.activeId)!.router.history).toHaveLength(1)
    // Não vira "aba fechada" na origem.
    expect(s.desktops[0]!.tabs.closed).toEqual([])
  })

  it('mover para um desktop onde o lugar já tem aba ativa a que existe lá', () => {
    let s = run(nav({ name: 'board' }), { type: 'create' }, nav({ name: 'board' }))
    s = desktopsReducer(s, nav({ name: 'agents' }))
    const second = activeDesktop(s).id
    s = desktopsReducer(s, { type: 'switch', id: s.desktops[0]!.id })
    s = desktopsReducer(s, { type: 'move-tab', to: second })
    expect(routesOf(s, 1)).toEqual([{ name: 'board' }, { name: 'agents' }])
    expect(currentRoute(s.desktops[1]!.tabs)).toEqual({ name: 'board' })
  })

  it('mover para um novo desktop', () => {
    let s = run(nav({ name: 'board' }), nav(task('a')))
    s = desktopsReducer(s, { type: 'move-tab', to: 'new' })
    expect(s.desktops).toHaveLength(2)
    expect(routesOf(s, 0)).toEqual([{ name: 'board' }])
    expect(routesOf(s, 1)).toEqual([task('a')])
    expect(activeDesktop(s).name).toBe('Desktop 1')
  })

  it('arranjo: painéis visíveis = a ativa + as usadas por último, na ordem das abas', () => {
    let s = run(
      nav({ name: 'board' }),
      { type: 'tabs', action: { type: 'open', route: { name: 'agents' } } },
      { type: 'tabs', action: { type: 'open', route: task('a') } },
      { type: 'tabs', action: { type: 'open', route: task('b') } }
    )
    expect(visiblePanels(activeDesktop(s))).toHaveLength(1)
    s = desktopsReducer(s, { type: 'arrange', arrangement: 'columns' })
    const names = (): Route[] => visiblePanels(activeDesktop(s)).map((t) => t.router.route)
    expect(names()).toEqual([{ name: 'agents' }, task('a'), task('b')])
    // Ativar uma aba escondida troca a menos usada das visíveis.
    const board = activeDesktop(s).tabs.tabs[0]!.id
    s = desktopsReducer(s, { type: 'tabs', action: { type: 'activate', id: board } })
    expect(names()).toEqual([{ name: 'board' }, task('a'), task('b')])
    s = desktopsReducer(s, { type: 'arrange', arrangement: 'grid' })
    expect(names()).toHaveLength(4)
  })
})

describe('abas entre desktops (tabs.ts)', () => {
  it('replace com id troca a rota daquela aba, não da ativa', () => {
    let t = tabsReducer(EMPTY_TABS, { type: 'navigate', route: { name: 'board' } })
    const tasksId = t.activeId!
    t = tabsReducer(t, { type: 'open', route: { name: 'agents' } })
    t = tabsReducer(t, { type: 'replace', id: tasksId, route: { name: 'board', view: 'list' } })
    expect(t.tabs.map((x) => x.router.route)).toEqual([
      { name: 'board', view: 'list' },
      { name: 'agents' }
    ])
    expect(currentRoute(t)).toEqual({ name: 'agents' })
  })

  it('takeTab/adoptTab e visibleTabs com uma aba só', () => {
    const t = tabsReducer(EMPTY_TABS, { type: 'navigate', route: { name: 'board' } })
    const taken = takeTab(t, t.activeId!)!
    expect(currentRoute(taken.state)).toEqual({ name: 'home' })
    expect(takeTab(t, 'nada')).toBeNull()
    const other = adoptTab(EMPTY_TABS, taken.tab)
    expect(currentRoute(other)).toEqual({ name: 'board' })
    expect(visibleTabs(other, 4)).toHaveLength(1)
    expect(visibleTabs(EMPTY_TABS, 4)).toEqual([])
  })
})

describe('desktops salvos', () => {
  it('ida e volta: nomes, arranjo, abas e o desktop atual', () => {
    let s = run(nav({ name: 'board' }), nav(task('a')), { type: 'create' })
    s = desktopsReducer(s, { type: 'rename', name: 'Pesquisa' })
    s = desktopsReducer(s, { type: 'arrange', arrangement: 'main-stack' })
    const saved = JSON.parse(JSON.stringify(serializeDesktops(s))) as unknown
    const back = desktopsReducer(EMPTY_DESKTOPS, {
      type: 'restore',
      saved: parseSavedDesktops(saved)!
    })
    expect(back.desktops.map((d) => [d.name, d.arrangement])).toEqual([
      ['Desktop 1', 'single'],
      ['Pesquisa', 'main-stack']
    ])
    expect(activeDesktop(back).name).toBe('Pesquisa')
    expect(routesOf(back, 0)).toEqual([{ name: 'board' }, task('a')])
    expect(currentRoute(back.desktops[0]!.tabs)).toEqual(task('a'))
  })

  it('valida tudo: rota ruim sai, arranjo desconhecido vira "Uma aba", nome vazio ganha um', () => {
    const saved = parseSavedDesktops({
      active: 7,
      desktops: [
        { name: '', arrangement: 'mosaico', tabs: { routes: [{ name: 'xpto' }], active: 0 } },
        { name: 'B'.repeat(80), arrangement: 'grid', tabs: { routes: [{ name: 'board' }] } },
        'lixo'
      ]
    })!
    expect(saved.active).toBe(1)
    expect(saved.desktops[0]).toEqual({ name: 'Desktop 1', arrangement: 'single', tabs: null })
    expect(saved.desktops[1]!.name).toHaveLength(40)
    // Desktop sem abas aproveitáveis volta com uma Início.
    const s = desktopsReducer(EMPTY_DESKTOPS, { type: 'restore', saved })
    expect(routesOf(s, 0)).toEqual([{ name: 'home' }])
    expect(parseSavedDesktops({ desktops: [] })).toBeNull()
    expect(parseSavedDesktops('x')).toBeNull()
  })

  it('migra o formato antigo (orkio.tabs) para o "Desktop 1"', () => {
    const legacy = { routes: [{ name: 'board' }, { name: 'agents' }], active: 1 }
    expect(loadSavedDesktops(null, legacy)).toEqual({
      desktops: [
        {
          name: 'Desktop 1',
          arrangement: 'single',
          tabs: { routes: [{ name: 'board' }, { name: 'agents' }], active: 1 }
        }
      ],
      active: 0
    })
    // O formato novo vence o antigo.
    const now = { desktops: [{ name: 'Novo', arrangement: 'single', tabs: null }], active: 0 }
    expect(loadSavedDesktops(now, legacy)!.desktops[0]!.name).toBe('Novo')
    expect(loadSavedDesktops(null, null)).toBeNull()
  })
})

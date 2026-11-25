import { describe, expect, it } from 'vitest'
import {
  EMPTY_TABS,
  MAX_TABS,
  activeTab,
  currentRoute,
  parseSavedTabs,
  serializeTabs,
  tabsReducer,
  type TabsAction,
  type TabsState
} from './tabs'
import { parseRoute, placeOf, type Route } from './routes'

const run = (...actions: TabsAction[]): TabsState => actions.reduce(tabsReducer, EMPTY_TABS)
const routes = (s: TabsState): Route[] => s.tabs.map((t) => t.router.route)
const task = (taskId: string): Route => ({ name: 'task', projectId: 'p1', taskId })
const nav = (route: Route): TabsAction => ({ type: 'navigate', route })

describe('tabsReducer', () => {
  it('Ctrl/⌘1 e o dock abrem o Quadro como estiver (recorte, visão e filtro)', () => {
    let s = run(
      nav({ name: 'board', projectIds: 'all', filter: 'review' }),
      nav({ name: 'agents' })
    )
    s = tabsReducer(s, nav({ name: 'board' }))
    expect(currentRoute(s)).toEqual({ name: 'board', projectIds: 'all', filter: 'review' })
    s = tabsReducer(s, { type: 'reset', route: { name: 'board' } })
    expect(currentRoute(s)).toEqual({ name: 'board', projectIds: 'all', filter: 'review' })
  })

  it('um lugar = uma aba: navegar para um lugar que já tem aba ativa a aba', () => {
    const s = run(nav({ name: 'board' }), nav(task('a')), nav({ name: 'agents' }), nav(task('a')))
    expect(routes(s)).toEqual([{ name: 'board' }, task('a'), { name: 'agents' }])
    expect(currentRoute(s)).toEqual(task('a'))
  })

  it('navegar dentro do mesmo lugar empilha o "Voltar" da aba', () => {
    let s = run(
      nav({ name: 'settings' }),
      nav({ name: 'settings', section: 'board', tab: 'flows' })
    )
    expect(s.tabs).toHaveLength(1)
    s = tabsReducer(s, nav({ name: 'settings' }))
    s = tabsReducer(s, { type: 'back' })
    expect(currentRoute(s)).toEqual({ name: 'settings', section: 'board', tab: 'flows' })
  })

  it('cada navegação remonta a tela (chave nova), mesmo para a mesma rota', () => {
    const a = run(nav({ name: 'board' }))
    const b = tabsReducer(a, nav({ name: 'board' }))
    expect(activeTab(b)!.router.key).toBeGreaterThan(activeTab(a)!.router.key)
  })

  it('Nova aba abre Início; navegar dela vira o lugar, ou ativa a aba que já existe', () => {
    let s = run(nav({ name: 'board' }), { type: 'open' })
    expect(currentRoute(s)).toEqual({ name: 'home' })
    s = tabsReducer(s, nav({ name: 'agents' }))
    expect(routes(s)).toEqual([{ name: 'board' }, { name: 'agents' }])
    s = tabsReducer(s, { type: 'open' })
    s = tabsReducer(s, nav({ name: 'board' }))
    expect(routes(s)).toEqual([{ name: 'board' }, { name: 'agents' }])
    expect(currentRoute(s)).toEqual({ name: 'board' })
  })

  it('fechar ativa a vizinha; fechar a última deixa uma Início; reabrir traz de volta', () => {
    let s = run(nav({ name: 'board' }), nav(task('a')), nav(task('b')), {
      type: 'activate',
      id: 't2'
    })
    expect(currentRoute(s)).toEqual(task('a'))
    s = tabsReducer(s, { type: 'close' })
    expect(currentRoute(s)).toEqual(task('b'))
    s = tabsReducer(s, { type: 'reopen' })
    expect(currentRoute(s)).toEqual(task('a'))
    for (let i = 0; i < 3; i++) s = tabsReducer(s, { type: 'close' })
    expect(routes(s)).toEqual([{ name: 'home' }])
  })

  it('reordena (arrastar e pelo teclado) e dá a volta no Ctrl+Tab', () => {
    let s = run(nav({ name: 'board' }), nav({ name: 'agents' }), nav({ name: 'settings' }))
    s = tabsReducer(s, { type: 'move', id: s.tabs[2]!.id, index: 0 })
    expect(routes(s).map((r) => r.name)).toEqual(['settings', 'board', 'agents'])
    s = tabsReducer(s, { type: 'shift', offset: 1 })
    expect(routes(s).map((r) => r.name)).toEqual(['board', 'settings', 'agents'])
    s = tabsReducer(s, { type: 'cycle', offset: 1 })
    expect(currentRoute(s)?.name).toBe('agents')
    s = tabsReducer(s, { type: 'cycle', offset: 1 })
    expect(currentRoute(s)?.name).toBe('board')
  })

  it('passou do limite, sai a aba usada há mais tempo (nunca a nova)', () => {
    let s = run(nav({ name: 'board' }))
    for (let i = 0; i < MAX_TABS; i++) s = tabsReducer(s, nav(task(`x${i}`)))
    expect(s.tabs).toHaveLength(MAX_TABS)
    expect(routes(s)).not.toContainEqual({ name: 'board' })
    expect(currentRoute(s)).toEqual(task(`x${MAX_TABS - 1}`))
  })

  it('Primeiros passos ficam por cima e não viram aba', () => {
    let s = run(nav({ name: 'board' }), nav({ name: 'setup' }))
    expect(currentRoute(s)).toEqual({ name: 'setup' })
    expect(s.tabs).toHaveLength(1)
    s = tabsReducer(s, nav({ name: 'agents' }))
    expect(s.overlay).toBeNull()
    expect(currentRoute(s)).toEqual({ name: 'agents' })
  })

  it('salvar e restaurar mantém a ordem e a ativa', () => {
    const s = run(nav({ name: 'board' }), nav(task('a')), nav({ name: 'agents' }), {
      type: 'activate',
      id: 't2'
    })
    const saved = parseSavedTabs(JSON.parse(JSON.stringify(serializeTabs(s))))!
    const back = tabsReducer(EMPTY_TABS, { type: 'restore', ...saved })
    expect(routes(back)).toEqual(routes(s))
    expect(currentRoute(back)).toEqual(task('a'))
  })
})

describe('abas salvas e rotas', () => {
  it('descarta o que não é rota válida; nada aproveitável = null', () => {
    expect(parseSavedTabs(null)).toBeNull()
    expect(parseSavedTabs({ routes: [{ name: 'setup' }, { name: 'x' }] })).toBeNull()
    expect(
      parseSavedTabs({ routes: [{ name: 'task', projectId: 'p' }, { name: 'agents' }], active: 9 })
    ).toEqual({ routes: [{ name: 'agents' }], active: 0 })
  })

  it('terminal da tarefa (Fase 2): uma aba por tarefa, separada da tela da tarefa', () => {
    const term: Route = { name: 'terminal', projectId: 'p1', taskId: 't1' }
    expect(placeOf(term)).toBe('terminal:p1:t1')
    expect(placeOf(term)).not.toBe(placeOf(task('t1')))
    const s = run(nav(task('t1')), nav(term), nav(task('t1')), nav({ ...term, start: 'claude' }))
    expect(routes(s)).toEqual([task('t1'), { ...term, start: 'claude' }])
    // "Continuar no Claude" pela paleta não volta sozinho ao reabrir o app.
    expect(parseRoute({ ...term, start: 'claude' })).toEqual(term)
    expect(parseRoute({ name: 'terminal', projectId: 'p1' })).toBeNull()
  })

  it('parseRoute fica só com campos conhecidos', () => {
    expect(
      parseRoute({ name: 'settings', section: 'board', tab: 'nada', projectId: 'p', x: 1 })
    ).toEqual({ name: 'settings', section: 'board', projectId: 'p' })
    expect(parseRoute({ name: 'tasks', view: 'list', filter: 'attention', x: 1 })).toEqual({
      name: 'tasks',
      view: 'list',
      filter: 'attention'
    })
    expect(parseRoute({ name: 'tasks', view: 'grade', filter: 1 })).toEqual({ name: 'tasks' })
    expect(parseRoute({ name: 'task', projectId: 'p', taskId: 't', section: 'flow' })).toEqual({
      name: 'task',
      projectId: 'p',
      taskId: 't',
      section: 'flow'
    })
  })

  it('lugar: tarefa por id; Início e Primeiros passos nunca dividem aba', () => {
    expect(placeOf(task('a'))).toBe('task:p1:a')
    expect(placeOf({ name: 'board', projectId: 'p2' })).toBe('board')
    expect(placeOf({ name: 'home' })).toBeNull()
    expect(placeOf({ name: 'setup' })).toBeNull()
  })
})

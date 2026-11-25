import { describe, expect, it } from 'vitest'
import {
  boardRoute,
  boardRouteAsIs,
  initialRouter,
  parseRoute,
  routeForTaskRef,
  routerReducer
} from './routes'

describe('routerReducer', () => {
  it('toda navegação gera chave nova, inclusive para a mesma rota (sai de subtelas)', () => {
    const a = routerReducer(initialRouter({ name: 'agents' }), {
      type: 'navigate',
      route: { name: 'board' }
    })
    const b = routerReducer(a, { type: 'navigate', route: { name: 'board' } })
    expect(b.route).toEqual({ name: 'board' })
    expect(b.key).toBeGreaterThan(a.key)
  })

  it('replace troca a rota sem remontar a tela nem entrar no histórico (abas)', () => {
    const start = routerReducer(initialRouter({ name: 'agents' }), {
      type: 'navigate',
      route: { name: 'settings', section: 'board', tab: 'columns' }
    })
    const next = routerReducer(start, {
      type: 'replace',
      route: { name: 'settings', section: 'board', tab: 'rules' }
    })
    expect(next.route).toEqual({ name: 'settings', section: 'board', tab: 'rules' })
    expect(next.key).toBe(start.key)
    expect(next.history).toEqual(start.history)
  })

  it('voltar retorna à rota anterior e não faz nada sem histórico', () => {
    const start = initialRouter({ name: 'agents' })
    expect(routerReducer(start, { type: 'back' })).toBe(start)
    const next = routerReducer(start, {
      type: 'navigate',
      route: { name: 'task', projectId: 'p1', taskId: 't1' }
    })
    const back = routerReducer(next, { type: 'back' })
    expect(back.route).toEqual({ name: 'agents' })
    expect(back.history).toEqual([])
  })

  it('histórico limitado', () => {
    let s = initialRouter({ name: 'agents' })
    for (let i = 0; i < 50; i++)
      s = routerReducer(s, { type: 'navigate', route: { name: 'board' } })
    expect(s.history.length).toBe(30)
  })
})

describe('routeForTaskRef', () => {
  it('abre a tela da tarefa com a seção', () => {
    expect(routeForTaskRef({ projectId: 'p2', taskId: 't9', section: 'flow' })).toEqual({
      name: 'task',
      projectId: 'p2',
      taskId: 't9',
      section: 'flow'
    })
  })

  it('sem seção não cria a chave', () => {
    const route = routeForTaskRef({ projectId: 'p2', taskId: 't9' })
    expect(route).toEqual({ name: 'task', projectId: 'p2', taskId: 't9' })
    expect('section' in route).toBe(false)
  })
})

describe('boardRoute / parseRoute do Quadro', () => {
  it('normaliza o recorte', () => {
    expect(boardRoute({ projectIds: ['a', 'a'] })).toEqual({ name: 'board', projectId: 'a' })
    expect(boardRoute({ projectId: 'x', projectIds: ['a', 'b'] })).toEqual({
      name: 'board',
      projectIds: ['a', 'b']
    })
    expect(boardRoute({ projectIds: [] })).toEqual({ name: 'board' })
    expect(boardRoute({ projectIds: 'all', view: 'list', filter: 'review' })).toEqual({
      name: 'board',
      projectIds: 'all',
      view: 'list',
      filter: 'review'
    })
  })
  it('parseRoute aceita só o que o tipo aceita', () => {
    expect(
      parseRoute({ name: 'board', projectIds: ['a', 7, 'b'], view: 'grade', filter: 'x' })
    ).toEqual({ name: 'board', projectIds: ['a', 'b'] })
    expect(parseRoute({ name: 'board', projectIds: 'all', filter: 'attention' })).toEqual({
      name: 'board',
      projectIds: 'all',
      filter: 'attention'
    })
  })
})

describe('boardRouteAsIs', () => {
  it('Quadro sem recorte mantém o recorte da aba (não o projeto)', () => {
    expect(
      boardRouteAsIs(
        { name: 'board', projectIds: 'all', view: 'list', filter: 'active' },
        { name: 'board' }
      )
    ).toEqual({ name: 'board', projectIds: 'all', view: 'list', filter: 'active' })
    expect(
      boardRouteAsIs({ name: 'board', projectId: 'a', view: 'list' }, { name: 'board' })
    ).toEqual({ name: 'board', view: 'list' })
  })
  it('rota com recorte ou outra tela não muda', () => {
    expect(
      boardRouteAsIs({ name: 'board', projectIds: 'all' }, { name: 'board', projectId: 'b' })
    ).toEqual({ name: 'board', projectId: 'b' })
    expect(boardRouteAsIs({ name: 'agents' }, { name: 'board' })).toEqual({ name: 'board' })
  })
})

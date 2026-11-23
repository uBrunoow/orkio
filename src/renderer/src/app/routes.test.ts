import { describe, expect, it } from 'vitest'
import {
  initialRouter,
  ROUTE_TITLES,
  routeForTaskRef,
  routerReducer,
  SETTINGS_TITLES
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

describe('títulos', () => {
  it('menu e configurações', () => {
    expect(ROUTE_TITLES.settings).toBe('Configurações')
    expect(ROUTE_TITLES.setup).toBe('Primeiros passos')
    expect(SETTINGS_TITLES.board).toBe('Quadro e automações')
    expect(SETTINGS_TITLES.agents).toBe('Agentes do projeto')
  })
})

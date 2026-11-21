import { describe, expect, it } from 'vitest'
import { initialRouter, isProjectRoute, routerReducer } from './routes'

describe('routerReducer', () => {
  it('toda navegação gera chave nova, inclusive para a mesma rota (sai de subtelas)', () => {
    const a = routerReducer(initialRouter({ name: 'projects' }), {
      type: 'navigate',
      route: { name: 'board' }
    })
    const b = routerReducer(a, { type: 'navigate', route: { name: 'board' } })
    expect(b.route).toEqual({ name: 'board' })
    expect(b.key).toBeGreaterThan(a.key)
  })

  it('voltar retorna à rota anterior e não faz nada sem histórico', () => {
    const start = initialRouter({ name: 'projects' })
    expect(routerReducer(start, { type: 'back' })).toBe(start)
    const next = routerReducer(start, {
      type: 'navigate',
      route: { name: 'board', projectId: 'p1', taskId: 't1' }
    })
    const back = routerReducer(next, { type: 'back' })
    expect(back.route).toEqual({ name: 'projects' })
    expect(back.history).toEqual([])
  })

  it('histórico limitado', () => {
    let s = initialRouter({ name: 'projects' })
    for (let i = 0; i < 50; i++)
      s = routerReducer(s, { type: 'navigate', route: { name: 'board' } })
    expect(s.history.length).toBe(30)
  })

  it('rotas de projeto', () => {
    expect(isProjectRoute({ name: 'flows', tab: 'alva' })).toBe(true)
    expect(isProjectRoute({ name: 'integrations' })).toBe(false)
  })
})

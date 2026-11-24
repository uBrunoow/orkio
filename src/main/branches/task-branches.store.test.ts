import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/database'
import { TaskBranchesStore } from './task-branches.store'

let db: Db
let store: TaskBranchesStore
beforeEach(() => {
  db = openDatabase(':memory:')
  store = new TaskBranchesStore(db, () => new Date('2026-11-23T12:00:00Z'))
})

describe('TaskBranchesStore', () => {
  it('liga, lista por tarefa e por projeto, e desfaz', () => {
    store.link('p1', 't1', 'feat/listar-pedidos', 'orkio')
    store.link('p1', 't1', 'fix/listar-pedidos', 'manual')
    store.link('p2', 't9', 'feat/outra', 'orkio')
    expect(store.forTask('p1', 't1').map((l) => [l.branch, l.source])).toEqual([
      ['feat/listar-pedidos', 'orkio'],
      ['fix/listar-pedidos', 'manual']
    ])
    expect(store.forProject('p1')).toEqual(
      new Map([['t1', ['feat/listar-pedidos', 'fix/listar-pedidos']]])
    )
    expect(store.unlink('p1', 't1', 'fix/listar-pedidos')).toBe(true)
    expect(store.unlink('p1', 't1', 'fix/listar-pedidos')).toBe(false)
    expect(store.forTask('p1', 't1')).toHaveLength(1)
  })

  it('a mesma branch num projeto pertence a uma tarefa só (vincular de novo troca)', () => {
    store.link('p1', 't1', 'feat/x', 'orkio')
    store.link('p1', 't2', 'feat/x', 'manual')
    expect(store.forTask('p1', 't1')).toEqual([])
    expect(store.forTask('p1', 't2')[0]?.source).toBe('manual')
  })
})

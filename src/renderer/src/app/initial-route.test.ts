import { describe, expect, it } from 'vitest'
import { initialRoute } from './initial-route'
import type { TaskGroups } from './task-groups'

const empty: TaskGroups = { waiting: [], running: [], todo: [], todoTotal: 0 }

describe('initialRoute', () => {
  it('sem projeto abre os Primeiros passos', () => {
    expect(initialRoute({ projectCount: 0, currentProjectId: null, groups: null })).toEqual({
      name: 'setup'
    })
  })

  it('com algo esperando você abre essa tarefa', () => {
    const groups: TaskGroups = {
      ...empty,
      waiting: [
        {
          taskId: 't1',
          displayId: 'ORK-1',
          title: 'x',
          tone: 'warning',
          detail: 'y',
          section: 'flow'
        }
      ]
    }
    expect(initialRoute({ projectCount: 1, currentProjectId: 'p1', groups })).toEqual({
      name: 'task',
      projectId: 'p1',
      taskId: 't1',
      section: 'flow'
    })
  })

  it('sem nada esperando abre o Quadro', () => {
    expect(initialRoute({ projectCount: 2, currentProjectId: 'p1', groups: empty })).toEqual({
      name: 'board'
    })
    expect(initialRoute({ projectCount: 1, currentProjectId: null, groups: null })).toEqual({
      name: 'board'
    })
  })
})

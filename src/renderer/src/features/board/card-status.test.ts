import { describe, expect, it } from 'vitest'
import { cardSyncStatus, laneBadge, prButtonText } from './card-status'
import type { PersonalTask, TaskLane } from '../../../../shared/task-lanes'
import type { TaskPullRequest } from '../../../../shared/task-signals'

const task = { projectId: 'p', projectName: 'P', taskId: 't', displayId: null, title: null }

function personal(lane: TaskLane, what = 'x'): PersonalTask {
  return { task, lane, what, chips: [], pr: null, since: '2026-01-01' }
}
function pr(over: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 7,
    title: 'feat',
    url: 'https://github.com/acme/app/pull/7',
    state: 'open',
    merged: false,
    headRef: 'feat/ORK-1',
    updatedAt: '2026-11-24T10:00:00.000Z',
    reviewDecision: null,
    unresolvedComments: 0,
    checks: null,
    ...over
  }
}

describe('laneBadge', () => {
  it('cores do app; concluído e sem tarefa não têm badge; o quê vai junto', () => {
    expect(laneBadge(personal('needs_you', 'Conferir o diff'))).toEqual({
      lane: 'needs_you',
      label: 'Precisa de você',
      tone: 'warning',
      what: 'Conferir o diff'
    })
    expect(laneBadge(personal('working'))?.tone).toBe('running')
    expect(laneBadge(personal('waiting'))?.tone).toBe('neutral')
    expect(laneBadge(personal('in_review'))?.label).toBe('Em revisão')
    expect(laneBadge(personal('done'))).toBeNull()
    expect(laneBadge(null)).toBeNull()
  })
})

describe('cardSyncStatus', () => {
  it('só a sincronização', () => {
    expect(cardSyncStatus({ sync: { state: 'synced' } })).toBeNull()
    expect(cardSyncStatus({ sync: { state: 'failed' } })).toEqual({
      label: 'Não sincronizou',
      tone: 'danger'
    })
    expect(cardSyncStatus({ sync: { state: 'pending' } })?.label).toBe('Sincronizando')
  })
})

describe('prButtonText', () => {
  it('número e rótulos da PR aberta, sem repetir', () => {
    expect(prButtonText(pr({ state: 'open', checks: 'failure', unresolvedComments: 2 }))).toBe(
      '#7 · CI falhando · Comentários'
    )
    expect(prButtonText(pr({ state: 'open', reviewDecision: 'approved', checks: 'success' }))).toBe(
      '#7 · Pronta'
    )
    expect(prButtonText(pr({ state: 'merged' }))).toBe('#7')
    expect(prButtonText(pr({ state: 'draft' }))).toBe('#7')
  })
})

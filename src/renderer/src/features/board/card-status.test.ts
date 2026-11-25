import { describe, expect, it } from 'vitest'
import { cardDetail, cardStatus, cardSyncStatus, laneBadge, prButtonText } from './card-status'
import type { PersonalTask, TaskLane } from '../../../../shared/task-lanes'
import type { TaskPullRequest } from '../../../../shared/task-signals'
import type { TaskSignals } from '../../../../shared/task-signals'
import type { RunningItem, WaitingItem } from '../../../../shared/overview'
import { NO_ACTIVITY, type TaskActivity } from '../overview/task-activity'

type Pr = NonNullable<TaskSignals['pr']>
const task = { projectId: 'p', projectName: 'P', taskId: 't', displayId: null, title: null }
const waiting = (kind: WaitingItem['kind']): TaskActivity => ({
  waiting: { key: 'w', kind, task, what: 'Aprovar', since: '2026-01-01', section: 'flow' },
  running: null
})
const running = (kind: RunningItem['kind']): TaskActivity => ({
  waiting: null,
  running: {
    key: 'r',
    kind,
    task,
    label: 'Fluxo',
    state: 'running',
    startedAt: '2026-01-01',
    section: 'flow'
  }
})
const flowRunning = running('flow')
const synced = { sync: { state: 'synced' as const } }
const withPr = (pr: Partial<Pr>): Pick<TaskSignals, 'pr'> => ({
  pr: { state: 'open', checks: null, reviewDecision: null, ...pr } as Pr
})

describe('cardStatus', () => {
  it('sem nada a dizer → null', () => {
    expect(cardStatus(synced, NO_ACTIVITY, undefined)).toBeNull()
  })

  it('esperando você vence tudo e só o fluxo rodando é laranja', () => {
    const s = cardStatus(
      { sync: { state: 'failed' } },
      waiting('gate'),
      withPr({ checks: 'failure' })
    )
    expect(s).toEqual({ kind: 'flow', label: 'Esperando você', tone: 'warning' })
    for (const other of [
      cardStatus({ sync: { state: 'failed' } }, NO_ACTIVITY, undefined),
      cardStatus(synced, NO_ACTIVITY, withPr({ checks: 'failure' })),
      cardStatus(synced, NO_ACTIVITY, withPr({ state: 'merged' }))
    ])
      expect(other?.tone).not.toBe('warning')
    expect(cardStatus(synced, flowRunning, undefined)?.tone).toBe('running')
  })

  it('qualquer espera da Visão geral (pergunta, permissão) é "Esperando você", não só o fluxo', () => {
    for (const kind of ['question', 'permission', 'flow_paused'] as const) {
      expect(cardStatus(synced, waiting(kind), undefined)?.label).toBe('Esperando você')
    }
  })

  it('execução avulsa do Claude Code não é "Fluxo rodando"', () => {
    expect(cardStatus(synced, running('run'), undefined)).toBeNull()
  })

  it('falhas antes do que está rodando', () => {
    expect(cardStatus({ sync: { state: 'failed' } }, flowRunning, undefined)?.label).toBe(
      'Não sincronizou'
    )
    expect(cardStatus(synced, flowRunning, withPr({ checks: 'failure' }))?.label).toBe('CI falhou')
    expect(
      cardStatus(synced, flowRunning, withPr({ reviewDecision: 'changes_requested' }))
    ).toEqual({
      kind: 'pr',
      label: 'Alterações pedidas',
      tone: 'danger'
    })
  })

  it('CI e revisão de PR fechada não contam', () => {
    expect(
      cardStatus(synced, NO_ACTIVITY, withPr({ state: 'merged', checks: 'failure' }))?.label
    ).toBe('Mergeada')
    expect(
      cardStatus(synced, NO_ACTIVITY, withPr({ state: 'closed', checks: 'failure' }))
    ).toBeNull()
  })

  it('sincronizando e PR aberta são neutros', () => {
    expect(cardStatus(synced, flowRunning, withPr({}))).toMatchObject({
      label: 'Fluxo rodando',
      tone: 'running'
    })
    expect(cardStatus({ sync: { state: 'pending' } }, NO_ACTIVITY, withPr({}))?.label).toBe(
      'Sincronizando'
    )
    expect(cardStatus(synced, NO_ACTIVITY, withPr({}))?.label).toBe('Em revisão')
    expect(cardStatus(synced, NO_ACTIVITY, withPr({ state: 'draft' }))?.label).toBe('PR rascunho')
  })
})

describe('cardDetail', () => {
  it('linha de detalhe do card', () => {
    expect(cardDetail({ waiting: 'Aprovar plano', running: 'Alva · /implement', pr: null })).toBe(
      'Aprovar plano'
    )
    expect(cardDetail({ waiting: null, running: 'Alva · /implement', pr: null })).toBe(
      'Alva · /implement'
    )
    expect(
      cardDetail({
        waiting: null,
        running: null,
        pr: { number: 31, unresolvedComments: 2, checks: 'success' } as Pr
      })
    ).toBe('#31 · 2 comentários')
    expect(
      cardDetail({
        waiting: null,
        running: null,
        pr: { number: 27, unresolvedComments: 0, checks: 'success' } as Pr
      })
    ).toBe('#27 · CI ok')
    expect(cardDetail({ waiting: null, running: null, pr: null })).toBeNull()
  })
})

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
    expect(cardSyncStatus({ sync: { state: 'failed' } })).toMatchObject({
      kind: 'sync',
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

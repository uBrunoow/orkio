import { describe, expect, it } from 'vitest'
import type { AgentRunView } from '../../../../shared/agent-run'
import type { TaskSignals } from '../../../../shared/task-signals'
import { taskProgress, type ProgressInput } from './task-progress'
import { buildSession, dayLabel, tailSession } from './task-session'
import type { BoardHistoryEntry } from '../../../../shared/board'
import type { TaskEventKind } from '../../../../shared/task-events'

const NOW = new Date('2026-11-22T15:00:00')

function ev(
  id: number,
  at: string,
  kind: TaskEventKind,
  detail: Record<string, unknown> = {}
): BoardHistoryEntry {
  return {
    id,
    at,
    kind,
    source: 'manual',
    fromStage: null,
    toStage: null,
    detail
  } as BoardHistoryEntry
}
function run(id: string, startedAt: string, over: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id,
    projectId: 'p1',
    taskId: 't1',
    mode: 'command',
    command: 'alva-flow:spec',
    status: 'succeeded',
    startedAt,
    endedAt: null,
    costUsd: null,
    text: null,
    branch: null,
    worktreePath: null,
    summary: null,
    hasSession: true,
    agentKey: null,
    ...over
  }
}

describe('buildSession', () => {
  it('junta eventos e execuções em ordem, por dia, sem repetir o que a execução já conta', () => {
    const history = [
      ev(5, '2026-11-22T10:05:00', 'run_finished'),
      ev(4, '2026-11-22T10:00:00', 'run_started'),
      ev(3, '2026-11-21T11:00:00', 'gate_approved', { step: 'Spec' }),
      ev(2, '2026-11-21T10:00:00', 'step_started'),
      ev(1, '2026-11-21T09:00:00', 'moved')
    ]
    const runs = [run('b', '2026-11-22T10:00:00'), run('a', '2026-11-21T10:00:00')]
    const items = buildSession(history, runs, NOW)
    expect(items.map((i) => (i.kind === 'day' ? i.label : i.key))).toEqual([
      'Ontem',
      'e1',
      'ra',
      'e3',
      'Hoje',
      'rb'
    ])
    const latest = items.filter((i) => i.kind === 'run').map((i) => i.kind === 'run' && i.latest)
    expect(latest).toEqual([false, true])
  })

  it('dia: Hoje, Ontem, data curta (com ano quando não é o atual)', () => {
    expect(dayLabel('2026-11-22T00:10:00', NOW)).toBe('Hoje')
    expect(dayLabel('2026-11-21T23:50:00', NOW)).toBe('Ontem')
    expect(dayLabel('2026-11-12T10:00:00', NOW)).toMatch(/12/)
    expect(dayLabel('2025-11-12T10:00:00', NOW)).toMatch(/2025/)
  })

  it('tailSession: só os últimos itens, com o separador do dia do primeiro visível', () => {
    const items = buildSession(
      [
        ev(4, '2026-11-22T10:00:00', 'moved'),
        ev(3, '2026-11-21T12:00:00', 'moved'),
        ev(2, '2026-11-21T11:00:00', 'moved'),
        ev(1, '2026-11-21T10:00:00', 'moved')
      ],
      [],
      NOW
    )
    const tail = tailSession(items, 2)
    expect(tail.hidden).toBe(2)
    expect(tail.items.map((i) => (i.kind === 'day' ? i.label : i.key))).toEqual([
      'Ontem',
      'e3',
      'Hoje',
      'e4'
    ])
    expect(tailSession(items, 10).hidden).toBe(0)
  })
})

function signals(
  pr: Partial<NonNullable<TaskSignals['pr']>> | null,
  local = ['ORK-1/x']
): TaskSignals {
  return {
    taskId: 't1',
    displayId: 'ORK-1',
    localBranches: local,
    remoteBranches: [],
    otherPrs: 0,
    pr: pr
      ? {
          number: 18,
          title: 'x',
          url: 'https://github.com/o/r/pull/18',
          state: 'open',
          merged: false,
          headRef: 'ORK-1/x',
          updatedAt: '2026-11-22T10:00:00Z',
          reviewDecision: null,
          unresolvedComments: 0,
          checks: null,
          ...pr
        }
      : null
  }
}
const base: ProgressInput = {
  backlog: null,
  signals: undefined,
  runs: [],
  uncommitted: null,
  running: false,
  waiting: 0
}
const view = (input: Partial<ProgressInput>) =>
  taskProgress({ ...base, ...input }).map((m) => `${m.label}:${m.state}:${m.detail}`)

describe('taskProgress', () => {
  it('sem vínculo com o Backlog: Código, PR, Revisão, Merge; o primeiro não feito é o atual', () => {
    expect(view({})).toEqual(['Código:current:—', 'PR:todo:—', 'Revisão:todo:—', 'Merge:todo:—'])
    expect(view({ running: true })[0]).toBe('Código:current:rodando')
  })

  it('alva: spec e plano pelo status do Backlog.md; esperando você marca o atual', () => {
    const task = {
      id: 'TASK-12',
      title: 'x',
      status: 'Architected',
      criteria: { done: 2, total: 5 },
      openQuestions: 0
    }
    expect(
      view({
        backlog: { linked: 'TASK-12', task },
        runs: [
          run('a', '2026-11-22T10:00:00', {
            summary: {
              files: ['a'],
              diffStat: '',
              commits: [{ hash: 'a', subject: 's' }],
              tests: []
            }
          })
        ],
        uncommitted: 3,
        waiting: 1
      })
    ).toEqual([
      'Spec:done:TASK-12',
      'Plano:done:critérios 2/5',
      'Código:waiting:esperando você',
      'PR:todo:—',
      'Revisão:todo:—',
      'Merge:todo:—'
    ])
    expect(
      view({
        backlog: { linked: 'TASK-12', task: { ...task, status: 'To Do', openQuestions: 2 } }
      })[0]
    ).toBe('Spec:current:2 perguntas em aberto')
  })

  it('PR com CI vermelho e alterações pedidas são problemas; merge conclui tudo', () => {
    expect(
      view({ signals: signals({ checks: 'failure', reviewDecision: 'changes_requested' }) })
    ).toEqual([
      'Código:done:pronto',
      'PR:problem:#18 · CI falhou',
      'Revisão:problem:alterações pedidas',
      'Merge:todo:—'
    ])
    expect(
      view({ signals: signals({ checks: 'success', reviewDecision: null, unresolvedComments: 2 }) })
    ).toContain('Revisão:current:2 comentários abertos')
    expect(view({ signals: signals({ state: 'merged', merged: true }) })).toEqual([
      'Código:done:pronto',
      'PR:done:#18',
      'Revisão:done:aprovada',
      'Merge:done:feito'
    ])
  })
})

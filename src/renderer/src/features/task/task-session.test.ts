import { describe, expect, it } from 'vitest'
import type { AgentRunView } from '../../../../shared/agent-run'
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

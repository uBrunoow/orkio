import { describe, expect, it } from 'vitest'
import type { AgentRunView } from '../../../../shared/agent-run'
import { runsOfSession, sideChats, taskSessions, visibleSessionId } from './task-sessions'

const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'

const run = (id: string, over: Partial<AgentRunView>): AgentRunView => ({
  id,
  projectId: 'p',
  taskId: 't',
  mode: 'prompt',
  command: null,
  status: 'succeeded',
  startedAt: '2026-11-25T10:00:00Z',
  endedAt: null,
  costUsd: null,
  text: null,
  branch: null,
  worktreePath: null,
  summary: null,
  hasSession: true,
  agentKey: null,
  sessionId: null,
  forkedFrom: null,
  side: false,
  ...over
})

// Como a tela recebe: mais recente primeiro.
const runs = [
  run('c', {
    sessionId: S2,
    forkedFrom: S1,
    text: 'outra ideia',
    startedAt: '2026-11-25T10:03:00Z',
    status: 'running'
  }),
  run('b', { sessionId: S1, text: 'continua', startedAt: '2026-11-25T10:02:00Z' }),
  run('x', { sessionId: null, startedAt: '2026-11-25T10:01:30Z', status: 'failed' }),
  run('a', {
    sessionId: S1,
    mode: 'command',
    command: 'spec',
    text: 'ORK-2',
    startedAt: '2026-11-25T10:01:00Z'
  })
]

describe('sessões da tarefa', () => {
  it('agrupa por sessão, a mais recente primeiro, com origem, título e estado', () => {
    expect(taskSessions(runs)).toEqual([
      {
        id: S2,
        number: 2,
        origin: 'fork',
        title: 'outra ideia',
        live: true,
        lastAt: '2026-11-25T10:03:00Z',
        runs: 1
      },
      {
        id: S1,
        number: 1,
        origin: 'new',
        title: '/spec ORK-2',
        live: false,
        lastAt: '2026-11-25T10:02:00Z',
        runs: 2
      }
    ])
  })

  it('mostra a escolhida ou a conversa completa', () => {
    expect(visibleSessionId(runs, S1)).toBe(S1)
    expect(visibleSessionId(runs, null)).toBeNull()
    expect(visibleSessionId(runs, '33333333-3333-4333-8333-333333333333')).toBeNull()
  })

  it('a conversa mostra só as execuções da sessão (as sem sessão ficam na mais recente)', () => {
    expect(runsOfSession(runs, S1).map((r) => r.id)).toEqual(['b', 'a'])
    expect(runsOfSession(runs, S2).map((r) => r.id)).toEqual(['c', 'x'])
    expect(runsOfSession(runs, null).map((r) => r.id)).toEqual(['c', 'b', 'x', 'a'])
  })
})

describe('sidechats', () => {
  const S3 = '33333333-3333-4333-8333-333333333333'
  const withSide = [
    run('s2', {
      sessionId: S3,
      side: true,
      text: 'e o teste?',
      startedAt: '2026-11-25T10:05:00Z',
      status: 'running'
    }),
    run('s1', {
      sessionId: S3,
      side: true,
      forkedFrom: S1,
      text: 'por que assim?',
      startedAt: '2026-11-25T10:04:00Z'
    }),
    ...runs
  ]

  it('ficam fora das sessões e da conversa principal', () => {
    expect(taskSessions(withSide).map((s) => s.id)).toEqual([S2, S1])
    expect(runsOfSession(withSide, S2).map((r) => r.id)).toEqual(['c', 'x'])
    expect(visibleSessionId(withSide, S3)).toBeNull()
  })

  it('agrupa os sidechats com as execuções da mais antiga para a mais recente', () => {
    const [chat] = sideChats(withSide)
    expect(chat).toMatchObject({ id: S3, title: 'por que assim?', live: true })
    expect(chat!.runs.map((r) => r.id)).toEqual(['s1', 's2'])
  })
})

import { describe, expect, it } from 'vitest'
import type { AgentBadge, AgentView } from '../../../../shared/agent'
import type { OverviewSnapshot, WaitingKind, WeekStats } from '../../../../shared/overview'
import { agentNow } from './agent-state'

const agent = (patch: Partial<AgentView> = {}): AgentView =>
  ({
    key: 'builtin:implementador',
    scope: 'builtin',
    id: 'implementador',
    file: 'x',
    status: 'ready',
    profile: null,
    errors: [],
    warnings: [],
    hash: 'h',
    assigned: 0,
    usageToday: { runs: 0, costUsd: 0 },
    activity: [],
    ...patch
  }) as AgentView

const badge = (key: string): AgentBadge => ({
  key,
  name: 'Implementador',
  color: 'orange',
  initials: 'IM',
  problem: null
})

const task = (taskId: string) => ({
  projectId: 'p1',
  projectName: 'Orkio',
  taskId,
  displayId: taskId.toUpperCase(),
  title: 't'
})

const WEEK: WeekStats = {
  since: '',
  finished: 0,
  prsOpened: null,
  prsMerged: null,
  cost: { usd: 0, known: 0, total: 0 },
  reviewAvgMs: null,
  reviewSamples: 0
}

const snapshot = (
  waiting: string[],
  running: string[],
  kind: WaitingKind = 'gate'
): OverviewSnapshot => ({
  generatedAt: '',
  week: WEEK,
  waiting: waiting.map((id) => ({
    key: id,
    kind,
    task: task(id),
    what: 'x',
    since: '',
    section: 'flow'
  })),
  running: running.map((id) => ({
    key: id,
    kind: 'flow',
    task: task(id),
    label: 'x',
    state: 'running',
    startedAt: '',
    section: 'flow'
  })),
  prs: [],
  projects: [],
  notices: []
})

const badges = {
  'ork-1': badge('builtin:implementador'),
  'ork-2': badge('builtin:implementador'),
  'ork-9': badge('builtin:revisor')
}

describe('agentNow', () => {
  it('esperando você vence trabalhando', () => {
    const now = agentNow({
      agent: agent(),
      badges,
      snapshot: snapshot(['ork-1'], ['ork-2', 'ork-9']),
      projectId: 'p1'
    })
    expect(now).toEqual({
      filter: 'waiting',
      tone: 'warning',
      text: 'Esperando você em ORK-1',
      tasks: [
        { taskId: 'ork-1', displayId: 'ORK-1', hot: true },
        { taskId: 'ork-2', displayId: 'ORK-2', hot: false }
      ]
    })
  })

  it('pergunta tem texto próprio', () => {
    expect(
      agentNow({
        agent: agent(),
        badges,
        snapshot: snapshot(['ork-1'], [], 'question'),
        projectId: 'p1'
      }).text
    ).toBe('Pergunta em ORK-1')
  })

  it('trabalhando', () => {
    const now = agentNow({
      agent: agent(),
      badges,
      snapshot: snapshot([], ['ork-2']),
      projectId: 'p1'
    })
    expect(now).toMatchObject({ filter: 'working', tone: 'running', text: 'Trabalhando em ORK-2' })
  })

  it('livre com tarefas atribuídas', () => {
    const now = agentNow({
      agent: agent({ assigned: 2 }),
      badges,
      snapshot: snapshot([], []),
      projectId: 'p1'
    })
    expect(now).toMatchObject({
      filter: 'stopped',
      tone: 'neutral',
      text: 'Livre · 2 tarefas atribuídas'
    })
    expect(agentNow({ agent: agent(), badges: {}, snapshot: null, projectId: 'p1' }).text).toBe(
      'Livre'
    )
  })

  it('perfil a revisar fica parado', () => {
    expect(
      agentNow({
        agent: agent({ status: 'needs_review' }),
        badges,
        snapshot: snapshot(['ork-1'], []),
        projectId: 'p1'
      })
    ).toMatchObject({ filter: 'stopped', text: 'Revisar perfil' })
    expect(
      agentNow({ agent: agent({ status: 'invalid' }), badges, snapshot: null, projectId: 'p1' })
        .text
    ).toBe('Perfil inválido')
  })
})

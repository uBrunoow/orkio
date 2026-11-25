import { describe, expect, it } from 'vitest'
import type { AgentRunView } from '../../../../shared/agent-run'
import { runActivity, sessionTotals } from './session-stats'

const run = (over: Partial<AgentRunView>): AgentRunView => ({
  id: 'r',
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

describe('painel Contexto', () => {
  it('soma custo e tempo das execuções terminadas', () => {
    expect(
      sessionTotals([
        run({ costUsd: 0.5, endedAt: '2026-11-25T10:02:00Z' }),
        run({ costUsd: 0.25, endedAt: '2026-11-25T10:01:00Z' }),
        run({ status: 'running' })
      ])
    ).toEqual({ runs: 3, costUsd: 0.75, workMs: 180_000 })
    expect(sessionTotals([run({})]).costUsd).toBeNull()
  })

  it('lê modelo, turnos e ferramentas da conversa principal', () => {
    expect(
      runActivity([
        { kind: 'init', model: 'claude-opus-5-5', plugins: [], commands: [] },
        { kind: 'tool', id: '1', tool: 'Read', summary: 'a' },
        { kind: 'subagent', id: '2', title: 'x', agentType: null, background: false, at: '' },
        { kind: 'tool', id: '3', tool: 'Read', summary: 'b', parent: '2' },
        { kind: 'result', ok: true, durationMs: 9000, costUsd: 0.1, turns: 4, text: '' }
      ])
    ).toEqual({ model: 'claude-opus-5-5', turns: 4, durationMs: 9000, tools: 1, subagents: 1 })
  })
})

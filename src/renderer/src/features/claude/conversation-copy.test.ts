import { describe, expect, it } from 'vitest'
import type { AgentRunView, RunLogEvent } from '../../../../shared/agent-run'
import { conversationMarkdown, lastAnswer } from './conversation-copy'

const run = (id: string, over: Partial<AgentRunView> = {}): AgentRunView => ({
  id,
  projectId: 'p',
  taskId: 't',
  mode: 'prompt',
  command: null,
  status: 'succeeded',
  startedAt: '2026-11-25T10:00:00Z',
  endedAt: '2026-11-25T10:01:00Z',
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

describe('copiar conversa', () => {
  it('junta pedidos e respostas da mais antiga para a mais recente, sem ferramentas', () => {
    const logs = new Map<string, RunLogEvent[]>([
      [
        'a',
        [
          { kind: 'text', text: 'Li o briefing.' },
          { kind: 'tool', id: '1', tool: 'Read', summary: 'x' }
        ]
      ],
      ['b', [{ kind: 'text', text: 'Feito.' }]]
    ])
    const md = conversationMarkdown(
      [
        run('b', { text: 'Agora os testes' }),
        run('a', { mode: 'command', command: 'spec', text: 'ORK-2' })
      ],
      logs
    )
    expect(md).toBe(
      '**Você:**\n\n/spec ORK-2\n\n**Claude:**\n\nLi o briefing.\n\n---\n\n**Você:**\n\nAgora os testes\n\n**Claude:**\n\nFeito.'
    )
  })

  it('última resposta', () => {
    expect(
      lastAnswer([
        { kind: 'text', text: 'um' },
        { kind: 'text', text: 'dois' }
      ])
    ).toBe('dois')
    expect(lastAnswer([])).toBeNull()
  })
})

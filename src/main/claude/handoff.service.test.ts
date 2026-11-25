import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/database'
import { HANDOFF_TEXT } from '../../shared/handoff'
import type { TerminalView } from '../../shared/terminal'
import { HandoffService, type HandoffDeps } from './handoff.service'

const SESSION = '0f8c2a3e-1b2c-4d5e-8f90-123456789abc'

function setup(over: Partial<HandoffDeps> = {}) {
  const db = openDatabase(':memory:')
  const terminals: TerminalView[] = []
  const calls: string[] = []
  let flow: ReturnType<HandoffDeps['flow']['activeFor']> = null
  const deps: HandoffDeps = {
    db,
    lastSession: () => SESSION,
    activeRun: () => null,
    cancelAndWait: async (runId) => void calls.push(`cancel:${runId}`),
    flow: {
      activeFor: () => flow,
      continueStep: async (id, text) => void calls.push(`continue:${id}:${text}`),
      completeStep: async (id) => void calls.push(`complete:${id}`)
    },
    sendMessage: async (_p, _t, text) => void calls.push(`send:${text}`),
    worktreePath: () => '/wt/ORK-1',
    terminals: {
      available: true,
      open: (input) => {
        calls.push(`open:${input.kind}:${input.sessionId}:${input.cwd}`)
        const view: TerminalView = {
          id: `t-${String(terminals.length + 1).padStart(6, '0')}`,
          projectId: input.projectId,
          taskId: input.taskId,
          kind: 'claude',
          title: 'Claude',
          state: 'running',
          exitCode: null,
          startedAt: new Date().toISOString()
        }
        terminals.push(view)
        return view
      },
      list: () => terminals,
      closeTask: async (_taskId, kind) => {
        calls.push(`close:${kind}`)
        terminals.splice(0)
      }
    },
    event: (_ref, e) => void calls.push(`event:${e.kind}`),
    changed: () => void calls.push('changed'),
    ...over
  }
  const svc = new HandoffService(deps)
  return {
    svc,
    calls,
    terminals,
    setFlow: (f: typeof flow) => {
      flow = f
    }
  }
}

describe('HandoffService ("Continuar no Claude")', () => {
  it('interrompe a execução, trava a sessão e abre o Claude no terminal da tarefa', async () => {
    const { svc, calls } = setup({ activeRun: () => 'run-9' })
    expect(svc.isLocked('t1')).toBe(false)
    const view = await svc.start('p1', 't1')
    expect(calls).toEqual([
      'cancel:run-9',
      // Terminais do Claude já terminados saem antes de abrir o da sessão de agora.
      'close:claude',
      `open:claude:${SESSION}:/wt/ORK-1`,
      'event:handoff_started',
      'changed'
    ])
    expect(view).toMatchObject({ sessionId: SESSION, terminalId: 't-000001', flowStep: false })
    expect(svc.isLocked('t1')).toBe(true)
    expect(svc.all()).toEqual([{ projectId: 'p1', taskId: 't1', since: view.since }])
    // De novo: já está com você; não abre outro terminal.
    await svc.start('p1', 't1')
    expect(calls.filter((c) => c.startsWith('open:'))).toHaveLength(1)
  })

  it('sem sessão ou sem pasta: recusa sem travar', async () => {
    await expect(setup({ lastSession: () => null }).svc.start('p1', 't1')).rejects.toMatchObject({
      code: 'no_session'
    })
    await expect(
      setup({ lastSession: () => '--resume' }).svc.start('p1', 't1')
    ).rejects.toMatchObject({ code: 'no_session' })
    const noDir = setup({ worktreePath: () => null })
    await expect(noDir.svc.start('p1', 't1')).rejects.toMatchObject({ code: 'no_workspace' })
    expect(noDir.svc.isLocked('t1')).toBe(false)
  })

  it('o terminal não abriu: a sessão não fica presa com você', async () => {
    const { svc } = setup({
      terminals: {
        available: true,
        open: () => {
          throw Object.assign(new Error('sem claude'), { code: 'no_claude' })
        },
        list: () => [],
        closeTask: async () => undefined
      }
    })
    await expect(svc.start('p1', 't1')).rejects.toThrow('sem claude')
    expect(svc.isLocked('t1')).toBe(false)
  })

  it('sem terminal embutido: trava assim mesmo (o comando vai para copiar)', async () => {
    const open = vi.fn()
    const { svc } = setup({
      terminals: { available: false, open, list: () => [], closeTask: async () => undefined }
    })
    const view = await svc.start('p1', 't1')
    expect(open).not.toHaveBeenCalled()
    expect(view.terminalId).toBeNull()
    expect(svc.isLocked('t1')).toBe(true)
  })

  it('"O Claude continua o passo": fecha o Claude do terminal, solta e retoma o passo parado', async () => {
    const { svc, calls, setFlow } = setup()
    setFlow({ id: 'fr-1', status: 'running', claudeStep: true })
    await svc.start('p1', 't1')
    setFlow({ id: 'fr-1', status: 'paused', claudeStep: true })
    calls.splice(0)
    await svc.giveBack('p1', 't1', 'continue')
    expect(calls).toEqual([
      'close:claude',
      'event:handoff_returned',
      `continue:fr-1:${HANDOFF_TEXT.continuePrompt}`,
      'changed'
    ])
    expect(svc.isLocked('t1')).toBe(false)
    await expect(svc.giveBack('p1', 't1', 'continue')).rejects.toMatchObject({ code: 'not_active' })
  })

  it('"Passo feito" conta o passo; sem fluxo, "continua" manda a mensagem na sessão', async () => {
    const a = setup()
    a.setFlow({ id: 'fr-2', status: 'paused', claudeStep: true })
    await a.svc.start('p1', 't1')
    expect(a.svc.get('t1')?.flowStep).toBe(true)
    await a.svc.giveBack('p1', 't1', 'done')
    expect(a.calls).toContain('complete:fr-2')

    const b = setup()
    await b.svc.start('p1', 't1')
    await b.svc.giveBack('p1', 't1', 'continue')
    expect(b.calls).toContain(`send:${HANDOFF_TEXT.continuePrompt}`)

    // Fluxo esperando outra coisa (gate): devolver só solta.
    const c = setup()
    c.setFlow({ id: 'fr-3', status: 'waiting_gate', claudeStep: false })
    await c.svc.start('p1', 't1')
    await c.svc.giveBack('p1', 't1', 'continue')
    expect(c.calls.some((x) => x.startsWith('continue:') || x.startsWith('send:'))).toBe(false)
  })

  it('projeto errado não mexe na sessão de outra tarefa', async () => {
    const { svc } = setup()
    await svc.start('p1', 't1')
    await expect(svc.giveBack('p2', 't1', 'done')).rejects.toMatchObject({ code: 'not_active' })
    expect(svc.isLocked('t1')).toBe(true)
  })
})

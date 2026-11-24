import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/ipc-contract'
import { DeliveryError } from '../delivery/delivery.service'
import { FlowError, type FlowRunner } from '../flows/flow-runner'
import type { FlowsService } from '../flows/flows.service'
import type { OpenPrDeps } from '../flows/open-pr'
import { registerTaskFlowsIpc } from './task-flows.ipc'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

function setup(openPrDeps: OpenPrDeps | null): Handler {
  const handlers = new Map<string, Handler>()
  registerTaskFlowsIpc(
    { handle: (c: string, h: Handler) => void handlers.set(c, h) } as never,
    {} as FlowsService,
    {} as FlowRunner,
    () => true,
    Promise.resolve(),
    openPrDeps
  )
  return handlers.get(IPC_CHANNELS.taskFlows.openPr)!
}

function deps(over: Partial<OpenPrDeps> = {}): OpenPrDeps {
  return {
    linked: () => false,
    blockReason: async () => null,
    compareUrl: () => 'https://github.com/o/r/compare/main...feat/x?expand=1',
    alreadyPushed: async () => false,
    startBuiltin: vi.fn(async () => ({}) as never),
    ...over
  }
}

describe('taskFlows.openPr (IPC)', () => {
  it('payload inválido ou sem dependências: pedido inválido', async () => {
    const h = setup(deps())
    for (const args of [
      ['../x', 't1'],
      ['p1', 5],
      [undefined, undefined]
    ]) {
      expect(await h({}, ...args)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    }
    const none = setup(null)
    expect(await none({}, 'p1', 't1')).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })

  it('devolve o resultado', async () => {
    const h = setup(deps())
    expect(await h({}, 'p1', 't1')).toEqual({
      ok: true,
      value: {
        started: true,
        mode: 'push',
        compareUrl: 'https://github.com/o/r/compare/main...feat/x?expand=1'
      }
    })
  })

  it('FlowError e DeliveryError viram a mensagem pt-BR, sem lançar', async () => {
    const busy = setup(
      deps({
        startBuiltin: async () => {
          throw new FlowError('busy', 'Já há um fluxo nesta tarefa.')
        }
      })
    )
    expect(await busy({}, 'p1', 't1')).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Já há um fluxo nesta tarefa.' }
    })
    const noTree = setup(
      deps({
        compareUrl: () => {
          throw new DeliveryError('no_worktree', 'Esta tarefa ainda não tem ambiente.')
        }
      })
    )
    expect(await noTree({}, 'p1', 't1')).toEqual({
      ok: false,
      error: { code: 'no_worktree', message: 'Esta tarefa ainda não tem ambiente.' }
    })
  })

  it('erro desconhecido: mensagem genérica, sem vazar o texto', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const h = setup(
      deps({
        compareUrl: () => {
          throw new Error('segredo-interno')
        }
      })
    )
    const r = await h({}, 'p1', 't1')
    expect(JSON.stringify(r)).not.toContain('segredo-interno')
    expect(r).toMatchObject({ ok: false, error: { code: 'unexpected' } })
    spy.mockRestore()
  })
})

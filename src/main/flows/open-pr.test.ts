import { describe, expect, it, vi } from 'vitest'
import type { Flow, FlowRunView } from '../../shared/task-flow'
import { openPr, type OpenPrDeps } from './open-pr'

function deps(over: Partial<OpenPrDeps> = {}): OpenPrDeps & { started: Flow[] } {
  const started: Flow[] = []
  return {
    started,
    linked: () => true,
    alvaReady: async () => true,
    compareUrl: () => 'https://github.com/o/r/compare/main...feat/x?expand=1',
    alreadyPushed: async () => false,
    startBuiltin: vi.fn(async (_p: string, _t: string, flow: Flow) => {
      started.push(flow)
      return {} as FlowRunView
    }),
    ...over
  }
}

describe('openPr', () => {
  it('com vínculo e alva-flow pronto: push + /pr em modo entrega', async () => {
    const d = deps()
    expect(await openPr(d, 'p', 't')).toEqual({ started: true, mode: 'pr', compareUrl: null })
    expect(d.started.map((f) => f.id)).toEqual(['builtin:abrir-pr'])
  })

  it('sem vínculo: só o push e o link de comparação', async () => {
    const d = deps({ linked: () => false })
    expect(await openPr(d, 'p', 't')).toMatchObject({
      mode: 'push',
      compareUrl: expect.any(String)
    })
    expect(d.started.map((f) => f.id)).toEqual(['builtin:enviar-branch'])
  })

  it('alva-flow não pronto (ou pré-checagem falhou): só o push', async () => {
    const a = deps({ alvaReady: async () => false })
    expect((await openPr(a, 'p', 't')).mode).toBe('push')
    const b = deps({
      alvaReady: async () => {
        throw new Error('x')
      }
    })
    expect((await openPr(b, 'p', 't')).mode).toBe('push')
  })

  it('sem ambiente: o erro do alvo sobe e nada começa', async () => {
    const d = deps({
      linked: () => false,
      compareUrl: () => {
        throw new Error('sem worktree')
      }
    })
    await expect(openPr(d, 'p', 't')).rejects.toThrow('sem worktree')
    expect(d.started).toEqual([])
  })

  it('branch já enviada + alva-flow: vai direto ao /pr, sem o passo de push', async () => {
    const d = deps({ alreadyPushed: async () => true })
    expect(await openPr(d, 'p', 't')).toEqual({ started: true, mode: 'pr', compareUrl: null })
    expect(d.started[0]?.steps.map((s) => s.id)).toEqual(['pr'])
  })

  it('branch já enviada sem alva-flow: nenhum fluxo, só o link', async () => {
    const d = deps({ linked: () => false, alreadyPushed: async () => true })
    expect(await openPr(d, 'p', 't')).toMatchObject({
      started: false,
      mode: 'push',
      compareUrl: expect.stringContaining('/compare/')
    })
    expect(d.started).toEqual([])
  })

  it('não deu para ver o remoto: segue com o push (o gate confere)', async () => {
    const d = deps({
      alreadyPushed: async () => {
        throw new Error('x')
      }
    })
    await openPr(d, 'p', 't')
    expect(d.started[0]?.steps.map((s) => s.id)).toEqual(['push', 'pr'])
  })
})

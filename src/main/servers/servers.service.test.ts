import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersService, ServerError, type ServersServiceDeps } from './servers.service'
import type { ServerDef } from '../../shared/servers'

const web: ServerDef = {
  id: 's-web',
  name: 'frontend',
  command: 'pnpm dev',
  cwd: 'apps/web',
  env: { VITE_API_URL: '{backend.url}' }
}
const api: ServerDef = {
  id: 's-api',
  name: 'backend',
  command: 'uvicorn app:app',
  portEnv: 'API_PORT'
}

interface Opened {
  id: string
  taskId: string
  cwd: string
  command: string
  env: Record<string, string>
  filter: (s: string) => string
  onExit: (code: number) => void
}

function setup(over: Partial<ServersServiceDeps> = {}) {
  let defs: Record<string, ServerDef[]> = { p1: [web, api] }
  const opened: Opened[] = []
  const closed: string[] = []
  const events: { taskId: string; kind: string; source: string; detail: unknown }[] = []
  const changed: string[] = []
  /** Portas onde "alguém" responde. */
  const listening = new Set<number>()
  let n = 0
  const deps: ServersServiceDeps = {
    defs: (projectId) => defs[projectId] ?? [],
    saveDefs: async (projectId, next) => {
      defs = { ...defs, [projectId]: next }
    },
    workspace: (taskId) => (taskId === 'sem' ? null : `/wt/${taskId}`),
    isDir: (p) => p.startsWith('/wt/'),
    terminals: {
      available: true,
      open: (input) => {
        const id = `t-${String(++n).padStart(6, '0')}`
        opened.push({
          id,
          taskId: input.taskId,
          cwd: input.cwd,
          command: input.command ?? '',
          env: input.env ?? {},
          filter: input.filter ?? ((s) => s),
          onExit: input.onExit ?? (() => undefined)
        })
        return {
          id,
          projectId: input.projectId,
          taskId: input.taskId,
          kind: 'server',
          title: input.title ?? '',
          state: 'running',
          exitCode: null,
          startedAt: '2026-11-26T12:00:00.000Z'
        }
      },
      close: async (id) => void closed.push(id)
    },
    portFree: async () => true,
    portOpen: async (port) => listening.has(port),
    envSecrets: () => ['segredo-do-env'],
    event: (ref, e) => void events.push({ taskId: ref.taskId, ...e }),
    changed: (ref) => void changed.push(ref.taskId),
    now: () => new Date('2026-11-26T12:00:00.000Z'),
    pollMs: 500,
    ...over
  }
  return { svc: new ServersService(deps), opened, closed, events, changed, listening }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ServersService', () => {
  it('sobe na subpasta do worktree, com a porta da faixa dele e a URL do outro servidor', async () => {
    const { svc, opened, events } = setup()
    const view = await svc.start('p1', 't1', 's-web', 'you')
    expect(view).toMatchObject({
      name: 'frontend',
      state: 'starting',
      port: 4100,
      url: 'http://localhost:4100',
      by: 'you'
    })
    expect(opened[0]).toMatchObject({ cwd: '/wt/t1/apps/web', command: 'pnpm dev' })
    expect(opened[0]!.env).toEqual({ PORT: '4100', VITE_API_URL: 'http://localhost:4200' })
    expect(opened[0]!.filter('x segredo-do-env y')).toBe('x [segredo omitido] y')
    expect(events).toEqual([
      {
        taskId: 't1',
        kind: 'server_started',
        source: 'manual',
        detail: { server: 'frontend', port: 4100, by: 'you' }
      }
    ])
    // A porta do backend ficou reservada: subir o backend usa a mesma da URL do frontend.
    const back = await svc.start('p1', 't1', 's-api', 'agent')
    expect(back.port).toBe(4200)
    expect(opened[1]!.env).toEqual({ API_PORT: '4200' })
    expect(events[1]).toMatchObject({ source: 'system', detail: { by: 'agent' } })
  })

  it('pronto quando a porta responde; sem responder no prazo, no_port', async () => {
    const { svc, listening } = setup()
    await svc.start('p1', 't1', 's-web', 'you')
    await svc.start('p1', 't2', 's-web', 'you')
    await vi.advanceTimersByTimeAsync(1_000)
    listening.add(4100)
    await vi.advanceTimersByTimeAsync(600)
    expect(svc.list('p1', 't1')[0]).toMatchObject({ state: 'ready' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(svc.list('p1', 't2')[0]).toMatchObject({ state: 'no_port', port: 4101 })
    expect(await svc.settled('t1', 's-web')).toMatchObject({ state: 'ready' })
  })

  it('mesma porta para a mesma tarefa ao subir de novo; tarefas diferentes nunca dividem', async () => {
    const busy = new Set([4100])
    const { svc } = setup({ portFree: async (p) => !busy.has(p) })
    expect((await svc.start('p1', 't1', 's-web', 'you')).port).toBe(4101)
    expect((await svc.start('p1', 't2', 's-web', 'you')).port).toBe(4102)
    await svc.stop('p1', 't1', 's-web', 'you')
    expect((await svc.start('p1', 't1', 's-web', 'you')).port).toBe(4101)
  })

  it('subir duas vezes não abre dois processos', async () => {
    const { svc, opened } = setup()
    await Promise.all([
      svc.start('p1', 't1', 's-web', 'you'),
      svc.start('p1', 't1', 's-web', 'you')
    ])
    expect(opened).toHaveLength(1)
  })

  it('saiu sozinho: exited com o código e evento; parar grava quem parou', async () => {
    const { svc, opened, events, closed } = setup()
    await svc.start('p1', 't1', 's-web', 'you')
    opened[0]!.onExit(1)
    expect(svc.list('p1', 't1')[0]).toMatchObject({
      state: 'exited',
      exitCode: 1,
      url: null,
      terminalId: opened[0]!.id
    })
    expect(events.at(-1)).toMatchObject({
      kind: 'server_stopped',
      source: 'system',
      detail: { server: 'frontend', by: 'exit', exitCode: 1 }
    })
    await svc.start('p1', 't1', 's-api', 'you')
    await svc.stop('p1', 't1', 's-api', 'you')
    expect(closed).toEqual([opened[1]!.id])
    expect(svc.list('p1', 't1')[1]).toMatchObject({ state: 'stopped', terminalId: null })
    expect(events.at(-1)).toMatchObject({
      kind: 'server_stopped',
      source: 'manual',
      detail: { server: 'backend', by: 'you', exitCode: null }
    })
  })

  it('stopTask para os servidores da tarefa (Limpar ambiente)', async () => {
    const { svc, closed } = setup()
    await svc.start('p1', 't1', 's-web', 'you')
    await svc.start('p1', 't1', 's-api', 'you')
    await svc.start('p1', 't2', 's-api', 'you')
    await svc.stopTask('t1')
    expect(closed).toHaveLength(2)
    expect(svc.list('p1', 't2')[1]).toMatchObject({ state: 'starting' })
  })

  it('servidor removido do cadastro rodando continua listado para parar', async () => {
    const { svc } = setup()
    await svc.start('p1', 't1', 's-web', 'you')
    await svc.save('p1', [api])
    expect(svc.list('p1', 't1').map((s) => [s.name, s.state, s.removed])).toEqual([
      ['backend', 'stopped', undefined],
      ['frontend', 'starting', true]
    ])
  })

  it('recusa: sem pasta, servidor desconhecido, limite de 8 e terminal indisponível', async () => {
    const { svc } = setup()
    await expect(svc.start('p1', 'sem', 's-web', 'you')).rejects.toMatchObject({
      code: 'no_workspace'
    })
    await expect(svc.start('p1', 't1', 's-nada', 'you')).rejects.toBeInstanceOf(ServerError)
    for (let i = 0; i < 4; i++) {
      await svc.start('p1', `t${i}`, 's-web', 'you')
      await svc.start('p1', `t${i}`, 's-api', 'you')
    }
    await expect(svc.start('p1', 't9', 's-web', 'you')).rejects.toMatchObject({ code: 'too_many' })
    const off = setup({
      terminals: { available: false, open: () => ({}) as never, close: async () => undefined }
    })
    await expect(off.svc.start('p1', 't1', 's-web', 'you')).rejects.toMatchObject({
      code: 'unavailable'
    })
  })

  it('salvar valida com as regras da tela', async () => {
    const { svc } = setup()
    await expect(svc.save('p1', [{ ...web, name: 'Front' }])).rejects.toMatchObject({
      code: 'invalid'
    })
    await svc.save('p1', [api])
    expect(svc.defs('p1')).toEqual([api])
  })

  it('URL só do servidor de pé desta tarefa', async () => {
    const { svc } = setup()
    expect(svc.urlOf('p1', 't1', 's-web')).toBeNull()
    await svc.start('p1', 't1', 's-web', 'you')
    expect(svc.urlOf('p1', 't1', 's-web')).toBe('http://localhost:4100')
    expect(svc.urlOf('p1', 't2', 's-web')).toBeNull()
  })
})

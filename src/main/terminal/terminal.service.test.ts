import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalService,
  TerminalServiceError,
  claudeResumeArgs,
  findExecutable,
  ptyEnv,
  userShell,
  type PtyProcess,
  type SpawnPty,
  type TerminalServiceDeps
} from './terminal.service'
import { TERMINAL_LIMITS } from '../../shared/terminal'

const SESSION = '0f8c2a3e-1b2c-4d5e-8f90-123456789abc'

interface FakePty extends PtyProcess {
  file: string
  args: string[]
  options: Parameters<SpawnPty>[2]
  written: string[]
  sizes: [number, number][]
  killed: boolean
  emit(data: string): void
  exit(code: number): void
}

function fakeSpawn(): { spawn: SpawnPty; ptys: FakePty[] } {
  const ptys: FakePty[] = []
  const spawn: SpawnPty = (file, args, options) => {
    const data = new Set<(d: string) => void>()
    const exits = new Set<(e: { exitCode: number }) => void>()
    const pty: FakePty = {
      pid: 1000 + ptys.length,
      file,
      args,
      options,
      written: [],
      sizes: [],
      killed: false,
      onData: (l) => {
        data.add(l)
        return { dispose: () => data.delete(l) }
      },
      onExit: (l) => {
        exits.add(l)
        return { dispose: () => exits.delete(l) }
      },
      write: (d) => void pty.written.push(d),
      resize: (c, r) => void pty.sizes.push([c, r]),
      kill: () => {
        pty.killed = true
        // O processo sai logo depois do sinal.
        setTimeout(() => pty.exit(129), 1)
      },
      emit: (d) => data.forEach((l) => l(d)),
      exit: (code) => [...exits].forEach((l) => l({ exitCode: code }))
    }
    ptys.push(pty)
    return pty
  }
  return { spawn, ptys }
}

const FILES = new Set(['/bin/zsh', '/bin/bash', '/home/u/.local/bin/claude'])
let n = 0
function service(over: Partial<TerminalServiceDeps> = {}) {
  const { spawn, ptys } = fakeSpawn()
  const data: { id: string; data: string; at: number }[] = []
  const changed: string[] = []
  const svc = new TerminalService({
    spawnPty: spawn,
    env: {
      PATH: '/usr/bin:/home/u/.local/bin',
      SHELL: '/bin/zsh',
      HOME: '/home/u',
      ANTHROPIC_API_KEY: 'sk-ant-secreto',
      ELECTRON_RUN_AS_NODE: '1',
      ORKIO_X: 'y'
    },
    platform: 'linux',
    isFile: (p) => FILES.has(p),
    isDir: (p) => p.startsWith('/wt/'),
    emitData: (e) => void data.push(e),
    emitChanged: (e) => void changed.push(e.taskId),
    newId: () => `t-${String(++n).padStart(6, '0')}`,
    flushMs: 5,
    ...over
  })
  return { svc, ptys, data, changed }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalService', () => {
  it('abre o shell do usuário (login) na pasta da tarefa, com o ambiente sem segredos', () => {
    const { svc, ptys, changed } = service()
    const view = svc.open({ projectId: 'p1', taskId: 't1', cwd: '/wt/ORK-1', kind: 'shell' })
    expect(view).toMatchObject({ kind: 'shell', title: 'zsh', state: 'running', taskId: 't1' })
    expect(ptys[0]!.file).toBe('/bin/zsh')
    expect(ptys[0]!.args).toEqual(['-l'])
    expect(ptys[0]!.options.cwd).toBe('/wt/ORK-1')
    const env = ptys[0]!.options.env
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['ELECTRON_RUN_AS_NODE']).toBeUndefined()
    expect(env['ORKIO_X']).toBeUndefined()
    expect(env['TERM']).toBe('xterm-256color')
    expect(changed).toEqual(['t1'])
    expect(svc.list('t1')).toHaveLength(1)
    expect(svc.list('t2')).toHaveLength(0)
  })

  it('Claude: `claude --resume <uuid>` achado no PATH, sem shell; id inválido nunca vira argumento', () => {
    const { svc, ptys } = service()
    svc.open({
      projectId: 'p1',
      taskId: 't1',
      cwd: '/wt/ORK-1',
      kind: 'claude',
      sessionId: SESSION
    })
    expect(ptys[0]!.file).toBe('/home/u/.local/bin/claude')
    expect(ptys[0]!.args).toEqual(['--resume', SESSION])
    expect(() =>
      svc.open({
        projectId: 'p1',
        taskId: 't1',
        cwd: '/wt/ORK-1',
        kind: 'claude',
        sessionId: '--x'
      })
    ).toThrow(TerminalServiceError)
    expect(() => claudeResumeArgs('abc; rm -rf /')).toThrow(/inválida/)
    expect(ptys).toHaveLength(1)
  })

  it('recusa sem módulo nativo, pasta inexistente, Claude fora do PATH e acima do limite', () => {
    expect(() =>
      service({ spawnPty: null }).svc.open({
        projectId: 'p',
        taskId: 't',
        cwd: '/wt/x',
        kind: 'shell'
      })
    ).toThrow(expect.objectContaining({ code: 'unavailable' }) as Error)
    const { svc } = service({ isFile: (p) => p === '/bin/bash' })
    expect(() =>
      svc.open({ projectId: 'p', taskId: 't', cwd: '/tmp/fora', kind: 'shell' })
    ).toThrow(expect.objectContaining({ code: 'no_workspace' }) as Error)
    expect(() =>
      svc.open({ projectId: 'p', taskId: 't', cwd: '/wt/x', kind: 'claude', sessionId: SESSION })
    ).toThrow(expect.objectContaining({ code: 'no_claude' }) as Error)
    for (let i = 0; i < TERMINAL_LIMITS.maxOpen; i++) {
      svc.open({ projectId: 'p', taskId: `t${i}`, cwd: '/wt/x', kind: 'shell' })
    }
    expect(() => svc.open({ projectId: 'p', taskId: 'z', cwd: '/wt/x', kind: 'shell' })).toThrow(
      expect.objectContaining({ code: 'too_many' }) as Error
    )
  })

  it('saída em lotes com a posição; a foto casa com os lotes; teclas e tamanho vão ao processo', async () => {
    const { svc, ptys, data } = service()
    const { id } = svc.open({ projectId: 'p', taskId: 't', cwd: '/wt/x', kind: 'shell' })
    ptys[0]!.emit('ola ')
    ptys[0]!.emit('mundo')
    expect(data).toEqual([]) // ainda no lote
    await vi.advanceTimersByTimeAsync(5)
    expect(data).toEqual([{ id, data: 'ola mundo', at: 0 }])
    ptys[0]!.emit('!')
    expect(svc.snapshot(id)).toEqual({ data: 'ola mundo', end: 9 }) // o lote pendente não entra
    await vi.advanceTimersByTimeAsync(5)
    expect(data.at(-1)).toEqual({ id, data: '!', at: 9 })
    svc.write(id, 'ls\r')
    svc.write(id, 'x'.repeat(TERMINAL_LIMITS.maxInput + 10))
    svc.resize(id, { cols: 120, rows: 40 })
    expect(ptys[0]!.written[0]).toBe('ls\r')
    expect(ptys[0]!.written[1]).toHaveLength(TERMINAL_LIMITS.maxInput)
    expect(ptys[0]!.sizes).toEqual([[120, 40]])
    expect(svc.snapshot('t-nao-existe')).toBeNull()
  })

  it('processo que sai fica na lista (só leitura); fechar mata, espera sair e esquece', async () => {
    const { svc, ptys } = service()
    const a = svc.open({ projectId: 'p', taskId: 't', cwd: '/wt/x', kind: 'shell' })
    const b = svc.open({
      projectId: 'p',
      taskId: 't',
      cwd: '/wt/x',
      kind: 'claude',
      sessionId: SESSION
    })
    ptys[0]!.exit(0)
    expect(svc.list('t').find((t) => t.id === a.id)).toMatchObject({ state: 'exited', exitCode: 0 })
    svc.write(a.id, 'ignorado')
    expect(ptys[0]!.written).toEqual([])
    expect(svc.hasRunning('t')).toBe(true)
    expect(svc.hasRunning('t', 'shell')).toBe(false)
    const closing = svc.closeTask('t', 'claude')
    await vi.advanceTimersByTimeAsync(5)
    await closing
    expect(ptys[1]!.killed).toBe(true)
    expect(svc.list('t').map((t) => t.id)).toEqual([a.id])
    expect(b.id).not.toBe(a.id)
    svc.stopAll()
    expect(svc.list('t')).toEqual([])
    expect(() => svc.open({ projectId: 'p', taskId: 't', cwd: '/wt/x', kind: 'shell' })).toThrow(
      TerminalServiceError
    )
  })
})

describe('shell e executáveis', () => {
  const isFile = (p: string): boolean => FILES.has(p) || p === 'C:\\Win\\powershell.exe'
  it('shell: $SHELL absoluto, senão os padrões; login só nos conhecidos', () => {
    expect(userShell({ SHELL: '/bin/bash' }, 'linux', isFile)).toEqual({
      file: '/bin/bash',
      args: ['-l']
    })
    expect(userShell({ SHELL: 'zsh' }, 'linux', isFile)?.file).toBe('/bin/zsh')
    expect(userShell({}, 'linux', () => false)).toBeNull()
    expect(userShell({ SHELL: '/bin/sh' }, 'linux', (p) => p === '/bin/sh')).toEqual({
      file: '/bin/sh',
      args: []
    })
  })

  it('executável só em pastas absolutas do PATH; no Windows só .exe', () => {
    expect(findExecutable('claude', { PATH: 'rel:/home/u/.local/bin' }, 'linux', isFile)).toBe(
      '/home/u/.local/bin/claude'
    )
    expect(findExecutable('claude', { PATH: '/usr/bin' }, 'linux', isFile)).toBeNull()
  })

  it('ambiente do PTY sem credenciais da Anthropic nem variáveis do Electron/Orkio', () => {
    const env = ptyEnv({
      PATH: '/bin',
      CLAUDE_CODE_OAUTH_TOKEN: 'x',
      ANTHROPIC_AUTH_TOKEN: 'y',
      ELECTRON_RUN_AS_NODE: '1',
      LANG: 'pt_BR.UTF-8'
    })
    expect(env).toEqual({
      PATH: '/bin',
      LANG: 'pt_BR.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    })
  })
})

import type { Effort } from '../../shared/agent-runtime'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRun, type PermissionBroker, type SpawnFn } from './runner'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-runner-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function argsOf(extra: {
  appendSystemPrompt?: string | null
  model?: string | null
  effort?: Effort | null
  resume?: boolean
  readOnly?: boolean
}): Promise<string[]> {
  let captured: string[] = []
  const spawn = ((_cmd: string, args: string[]) => {
    captured = args
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child['stdin'] = new PassThrough()
    child['stdout'] = new PassThrough()
    child['stderr'] = new PassThrough()
    child['kill'] = () => true
    return child
  }) as unknown as SpawnFn
  const run = new ClaudeRun({
    claudeCommand: 'claude',
    cwd: dir,
    prompt: 'oi',
    sessionId: 's1',
    broker: { socketPath: join(dir, 's.sock'), token: 't' } as unknown as PermissionBroker,
    nodePath: process.execPath,
    bridgeScript: 'bridge.js',
    tmpDir: dir,
    env: {},
    onEvent: () => undefined,
    onExit: () => undefined,
    spawn,
    ...extra
  })
  await run.start()
  return captured
}

describe('ClaudeRun (8A: agente)', () => {
  it('sem agente: nenhuma flag de agente', async () => {
    const args = await argsOf({})
    expect(args).not.toContain('--append-system-prompt')
    expect(args).not.toContain('--model')
  })

  it('com agente: instruções no --append-system-prompt e o modelo; permissões iguais', async () => {
    const base = await argsOf({})
    const args = await argsOf({ appendSystemPrompt: 'Você é Ana.', model: 'sonnet' })
    expect(
      args.slice(args.indexOf('--append-system-prompt'), args.indexOf('--append-system-prompt') + 2)
    ).toEqual(['--append-system-prompt', 'Você é Ana.'])
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'sonnet'
    ])
    // As flags de permissão continuam exatamente as mesmas.
    const perm = (a: string[]): string[] =>
      a.filter((_, i) =>
        ['--permission-mode', '--settings', '--permission-prompt-tool'].includes(a[i - 1] ?? '')
      )
    expect(perm(args)).toEqual(perm(base))
  })

  it('modelo que parece outra flag é ignorado', async () => {
    const args = await argsOf({ model: '--dangerously-skip-permissions' })
    expect(args).not.toContain('--model')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })
})

describe('ClaudeRun (sessão)', () => {
  it('sessão nova usa --session-id; continuar usa --resume com o mesmo id', async () => {
    const fresh = await argsOf({})
    expect(fresh[fresh.indexOf('--session-id') + 1]).toBe('s1')
    expect(fresh).not.toContain('--resume')
    const resumed = await argsOf({ resume: true })
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe('s1')
    expect(resumed).not.toContain('--session-id')
  })

  it('modelo e raciocínio válidos viram --model e --effort', async () => {
    const args = await argsOf({ model: 'opus', effort: 'high' })
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'opus'
    ])
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual([
      '--effort',
      'high'
    ])
  })

  it('raciocínio desconhecido, modelo malicioso e "default" não viram flag', async () => {
    const bad = await argsOf({ effort: 'ultra' as never })
    expect(bad).not.toContain('--effort')
    expect(bad).not.toContain('ultra')
    for (const model of ['--x', 'a b', 'opus;rm', 'Opus']) {
      expect(await argsOf({ model })).not.toContain('--model')
    }
    expect(await argsOf({ model: 'default' })).not.toContain('--model')
    expect(await argsOf({ model: null, effort: null })).not.toContain('--effort')
  })
})

describe('ClaudeRun (passo só de leitura)', () => {
  it('readOnly nega as ferramentas de edição num argumento só; sem ele, nada', async () => {
    const args = await argsOf({ readOnly: true })
    const at = args.indexOf('--disallowedTools')
    expect(at).toBeGreaterThan(0)
    expect(args[at + 1]).toBe('Edit,Write,MultiEdit,NotebookEdit')
    // A opção aceita vários valores: o próximo argumento precisa ser outra flag.
    expect(args[at + 2]?.startsWith('--')).toBe(true)
    // A ferramenta de permissão do Orkio continua, e nada é aprovado sozinho.
    expect(args).toContain('mcp__orkio__approve')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('manual')
    for (const plain of [await argsOf({}), await argsOf({ readOnly: false })]) {
      expect(plain).not.toContain('--disallowedTools')
      expect(plain[plain.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    }
  })
})

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

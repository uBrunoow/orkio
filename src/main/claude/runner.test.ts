import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeChoice } from '../../shared/agent-runtime'
import { READ_ONLY_DENIED_TOOLS } from '../../shared/task-flow'
import { BRIDGE_PROMPT_TOOL } from './bridge/protocol'
import type { RunSpec } from './run-spec'
import {
  ClaudeRun,
  DELIVERY_RUN_SETTINGS,
  RUN_SETTINGS,
  buildCliArgs,
  type PermissionBroker,
  type SpawnFn
} from './runner'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-runner-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const target = {
  owner: 'acme',
  repo: 'app',
  remote: 'origin',
  branch: 'feat/ORK-1',
  defaultBranch: 'main',
  displayId: 'ORK-1'
}

type CliSpec = Pick<RunSpec, 'session' | 'access' | 'agent' | 'runtime'>
const NEW: CliSpec['session'] = { kind: 'new', briefing: 'b', includeBriefing: true }

function spec(
  over: Partial<Omit<CliSpec, 'runtime'>> & { runtime?: Partial<RuntimeChoice> } = {}
): CliSpec {
  return {
    session: over.session ?? NEW,
    access: over.access ?? { tools: 'full', github: null },
    agent: over.agent ?? null,
    runtime: { model: null, effort: null, ...over.runtime }
  }
}
const args = (over: Parameters<typeof spec>[0] = {}): string[] =>
  buildCliArgs(spec(over), { sessionId: 's1', mcpConfig: '/tmp/x.mcp.json' })
const after = (a: string[], flag: string): string | undefined => a[a.indexOf(flag) + 1]
const settings = (a: string[]): unknown => JSON.parse(after(a, '--settings') ?? 'null')

describe('buildCliArgs', () => {
  it('sessão nova usa --session-id; continuar usa --resume com o id da sessão', () => {
    const fresh = args()
    expect(after(fresh, '--session-id')).toBe('s1')
    expect(fresh).not.toContain('--resume')
    const resumed = args({ session: { kind: 'resume', id: 'antiga' } })
    expect(after(resumed, '--resume')).toBe('antiga')
    expect(resumed).not.toContain('--session-id')
  })

  it('agente: instruções no --append-system-prompt; permissões iguais', () => {
    const base = args()
    const a = args({
      agent: { key: 'k', name: 'Ana', prompt: 'Você é Ana.', model: null, effort: null },
      runtime: { model: 'sonnet' }
    })
    expect(after(a, '--append-system-prompt')).toBe('Você é Ana.')
    expect(after(a, '--model')).toBe('sonnet')
    const perm = (x: string[]): string[] =>
      x.filter((_, i) =>
        ['--permission-mode', '--settings', '--permission-prompt-tool'].includes(x[i - 1] ?? '')
      )
    expect(perm(a)).toEqual(perm(base))
    expect(base).not.toContain('--append-system-prompt')
    expect(base).not.toContain('--model')
  })

  it('modelo e raciocínio válidos viram flag; o que parece outra flag não', () => {
    const a = args({ runtime: { model: 'opus', effort: 'high' } })
    expect(after(a, '--model')).toBe('opus')
    expect(after(a, '--effort')).toBe('high')
    expect(args({ runtime: { effort: 'ultra' as never } })).not.toContain('--effort')
    for (const model of ['--dangerously-skip-permissions', 'a b', 'opus;rm', 'Opus']) {
      expect(args({ runtime: { model } })).not.toContain('--model')
    }
  })

  it('só leitura: sem as ferramentas de edição (um argumento só) e nada aprovado sozinho', () => {
    const a = args({ access: { tools: 'read_only', github: null } })
    expect(after(a, '--disallowedTools')).toBe(READ_ONLY_DENIED_TOOLS.join(','))
    // A opção aceita vários valores: o próximo argumento precisa ser outra flag.
    expect(a[a.indexOf('--disallowedTools') + 2]?.startsWith('--')).toBe(true)
    expect(after(a, '--permission-prompt-tool')).toBe(BRIDGE_PROMPT_TOOL)
    expect(after(a, '--permission-mode')).toBe('manual')
    const plain = args()
    expect(plain).not.toContain('--disallowedTools')
    expect(after(plain, '--permission-mode')).toBe('acceptEdits')
  })

  it('o deny do CLI é o da entrega só no modo entrega', () => {
    expect(settings(args())).toEqual(RUN_SETTINGS)
    expect(settings(args({ access: { tools: 'full', github: { mode: 'read', target } } }))).toEqual(
      RUN_SETTINGS
    )
    expect(
      settings(
        args({
          access: {
            tools: 'full',
            github: { mode: 'deliver', target, requirePushApproval: true }
          }
        })
      )
    ).toEqual(DELIVERY_RUN_SETTINGS)
  })
})

describe('ClaudeRun', () => {
  it('roda o claude com os argumentos de buildCliArgs e o mcp-config da ponte (0600)', async () => {
    let captured: string[] = []
    const spawn = ((_cmd: string, a: string[]) => {
      captured = a
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>
      child['stdin'] = new PassThrough()
      child['stdout'] = new PassThrough()
      child['stderr'] = new PassThrough()
      child['kill'] = () => true
      return child
    }) as unknown as SpawnFn
    const s = spec({ runtime: { model: 'opus' } }) as RunSpec
    const run = new ClaudeRun({
      claudeCommand: 'claude',
      spec: s,
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
      spawn
    })
    await run.start()
    const mcpConfig = after(captured, '--mcp-config')!
    expect(captured).toEqual(buildCliArgs(s, { sessionId: 's1', mcpConfig }))
    const config = JSON.parse(await readFile(mcpConfig, 'utf8')) as {
      mcpServers: Record<string, { env: Record<string, string> }>
    }
    expect(Object.keys(config.mcpServers)).toEqual(['orkio'])
    expect(config.mcpServers['orkio']!.env).toMatchObject({
      ORKIO_BRIDGE_SOCKET: join(dir, 's.sock'),
      ORKIO_BRIDGE_TOKEN: 't'
    })
  })
})

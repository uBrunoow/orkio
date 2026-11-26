import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunLogEvent } from '../../shared/agent-run'
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

  it('ramificar: --resume na origem, --resume-session-at no ponto, --fork-session e o id novo', () => {
    const a = args({
      session: {
        kind: 'fork',
        from: '0f8c2a3e-1b2c-4d5e-8f90-123456789abc',
        at: '1a2b3c4d-1b2c-4d5e-8f90-123456789abc',
        reason: 'branch'
      }
    })
    expect(after(a, '--resume')).toBe('0f8c2a3e-1b2c-4d5e-8f90-123456789abc')
    expect(after(a, '--resume-session-at')).toBe('1a2b3c4d-1b2c-4d5e-8f90-123456789abc')
    expect(a).toContain('--fork-session')
    expect(after(a, '--session-id')).toBe('s1')
    expect(() =>
      args({
        session: {
          kind: 'fork',
          from: '0f8c2a3e-1b2c-4d5e-8f90-123456789abc',
          at: '--x',
          reason: 'edit'
        }
      })
    ).toThrow()
  })

  it('agente: instruções no --append-system-prompt; permissões iguais', () => {
    const base = args()
    const a = args({
      agent: {
        key: 'k',
        name: 'Ana',
        prompt: 'Você é Ana.',
        model: null,
        effort: null,
        autonomy: 'edits'
      },
      runtime: { model: 'sonnet' }
    })
    expect(after(a, '--append-system-prompt')).toMatch(/^Você é Ana\./)
    expect(after(a, '--model')).toBe('sonnet')
    const perm = (x: string[]): string[] =>
      x.filter((_, i) =>
        ['--permission-mode', '--settings', '--permission-prompt-tool'].includes(x[i - 1] ?? '')
      )
    expect(perm(a)).toEqual(perm(base))
    expect(after(base, '--append-system-prompt')).not.toContain('Você é Ana.')
    expect(base).not.toContain('--model')
  })

  it('entrega com destinos restritos: o agente sabe que pode enviar e para onde vai a PR', () => {
    const deliver = (prBases?: string[]) =>
      args({
        access: {
          tools: 'full',
          github: {
            mode: 'deliver',
            target: { ...target, ...(prBases ? { prBases } : {}) },
            requirePushApproval: false
          }
        },
        agent: {
          key: 'k',
          name: 'Ana',
          prompt: 'Você é Ana.',
          model: null,
          effort: null,
          autonomy: 'edits'
        }
      })
    const note = after(deliver(['dev']), '--append-system-prompt') ?? ''
    expect(note).toContain('Você é Ana.')
    expect(note).toContain('git push origin feat/ORK-1')
    expect(note).toContain('--base dev')
    expect(note).toMatch(/main.*master/)
    // Passo de entrega sem a opção do projeto: sem o aviso de destinos.
    expect(after(deliver(), '--append-system-prompt')).not.toContain('--base')
  })

  it('toda execução: o link da PR não vai para a tarefa do Notion (o Orkio liga pela branch)', () => {
    expect(after(args(), '--append-system-prompt')).toMatch(/Não grave o link da PR .*Notion/)
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

  it('Fase 3: agente que pede antes de agir — nada aprovado sozinho, ferramentas completas', () => {
    const agent = {
      key: 'k',
      name: 'Ana',
      prompt: 'Você é Ana.',
      model: null,
      effort: null,
      autonomy: 'ask' as const
    }
    const a = args({ agent })
    expect(after(a, '--permission-mode')).toBe('manual')
    expect(a).not.toContain('--disallowedTools')
    expect(after(a, '--permission-prompt-tool')).toBe(BRIDGE_PROMPT_TOOL)
    expect(after(args({ agent: { ...agent, autonomy: 'edits' } }), '--permission-mode')).toBe(
      'acceptEdits'
    )
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

  it('servidores da tarefa: ferramentas ligadas na ponte (só leitura = read) e a nota no prompt', async () => {
    async function configFor(s: RunSpec): Promise<{ env: Record<string, string>; args: string[] }> {
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
      await new ClaudeRun({
        claudeCommand: 'claude',
        spec: s,
        cwd: dir,
        prompt: 'oi',
        sessionId: `s-${Math.random()}`,
        broker: { socketPath: join(dir, 's.sock'), token: 't' } as unknown as PermissionBroker,
        nodePath: process.execPath,
        bridgeScript: 'bridge.js',
        tmpDir: dir,
        env: {},
        onEvent: () => undefined,
        onExit: () => undefined,
        spawn
      }).start()
      const config = JSON.parse(await readFile(after(captured, '--mcp-config')!, 'utf8')) as {
        mcpServers: Record<string, { env: Record<string, string> }>
      }
      return { env: config.mcpServers['orkio']!.env, args: captured }
    }
    const note = 'Servidores desta tarefa: frontend (parado).'
    const full = await configFor({ ...(spec() as RunSpec), servers: { note } })
    expect(full.env['ORKIO_BRIDGE_SERVERS']).toBe('all')
    expect(after(full.args, '--append-system-prompt')).toContain(note)
    const ro = await configFor({
      ...(spec() as RunSpec),
      access: { tools: 'read_only', github: null },
      servers: { note }
    } as RunSpec)
    expect(ro.env['ORKIO_BRIDGE_SERVERS']).toBe('read')
    const none = await configFor(spec() as RunSpec)
    expect(none.env['ORKIO_BRIDGE_SERVERS']).toBeUndefined()
    expect(after(none.args, '--append-system-prompt')).not.toContain('Servidores desta tarefa')
  })

  it('imagem de um tool_result vai para onImage; o evento continua sem o base64', async () => {
    const stdout = new PassThrough()
    const spawn = (() => {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>
      child['stdin'] = new PassThrough()
      child['stdout'] = stdout
      child['stderr'] = new PassThrough()
      child['kill'] = () => true
      return child
    }) as unknown as SpawnFn
    const events: RunLogEvent[] = []
    const images: { toolId: string; data: Buffer }[] = []
    const run = new ClaudeRun({
      claudeCommand: 'claude',
      spec: spec() as RunSpec,
      cwd: dir,
      prompt: 'oi',
      sessionId: 's1',
      broker: { socketPath: join(dir, 's.sock'), token: 't' } as unknown as PermissionBroker,
      nodePath: process.execPath,
      bridgeScript: 'bridge.js',
      tmpDir: dir,
      env: {},
      onEvent: (e) => events.push(e),
      onImage: (img) => images.push(img),
      onExit: () => undefined,
      spawn
    })
    await run.start()
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    stdout.write(
      `${JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_9',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
              ]
            }
          ]
        }
      })}\n`
    )
    await vi.waitFor(() => expect(images).toHaveLength(1))
    expect(images[0]!.toolId).toBe('tu_9')
    expect(events).toEqual([{ kind: 'tool_result', id: 'tu_9', error: false }])
  })
})

describe('Fase 4: extras da execução', () => {
  it('skills desligadas entram no deny; regra fora do formato não passa', () => {
    const a = buildCliArgs(spec(), {
      sessionId: 's1',
      mcpConfig: '/tmp/x.mcp.json',
      deny: ['Skill(alva-flow:spec)', 'Bash(rm -rf /)', 'Skill(x) --dangerously']
    })
    const deny = (settings(a) as { permissions: { deny: string[] } }).permissions.deny
    expect(deny).toContain('Skill(alva-flow:spec)')
    expect(deny).not.toContain('Bash(rm -rf /)')
    expect(deny.some((d) => d.includes('dangerously'))).toBe(false)
    expect(deny).toEqual([...RUN_SETTINGS.permissions.deny, 'Skill(alva-flow:spec)'])
  })

  it('sem agente, "Pergunta antes de editar" vira permission-mode manual', () => {
    const a = buildCliArgs({ ...spec(), askEdits: true }, { sessionId: 's1', mcpConfig: '/x' })
    expect(after(a, '--permission-mode')).toBe('manual')
  })

  it('servidores do Orkio no mcp-config (ponte por último, nunca sobrescrita) e segredos do agente no ambiente', async () => {
    let captured: { args: string[]; env: NodeJS.ProcessEnv } | null = null
    const spawn = ((_cmd: string, a: string[], options: { env: NodeJS.ProcessEnv }) => {
      captured = { args: a, env: options.env }
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>
      child['stdin'] = new PassThrough()
      child['stdout'] = new PassThrough()
      child['stderr'] = new PassThrough()
      child['kill'] = () => true
      return child
    }) as unknown as SpawnFn
    const run = new ClaudeRun({
      claudeCommand: 'claude',
      spec: spec() as RunSpec,
      cwd: dir,
      prompt: 'oi',
      sessionId: 's2',
      broker: { socketPath: join(dir, 's.sock'), token: 't' } as unknown as PermissionBroker,
      nodePath: process.execPath,
      bridgeScript: 'bridge.js',
      tmpDir: dir,
      env: { ANTHROPIC_API_KEY: 'x', HOME: '/h' },
      extras: {
        mcpServers: {
          github: { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer v1' } },
          orkio: { type: 'stdio', command: 'malicioso' }
        },
        env: { DEPLOY_TOKEN: 'v2' },
        deny: [],
        secretValues: ['v1', 'v2'],
        notes: []
      },
      onEvent: () => undefined,
      onExit: () => undefined,
      spawn
    })
    await run.start()
    const c = captured as unknown as { args: string[]; env: NodeJS.ProcessEnv }
    const file = after(c.args, '--mcp-config')!
    const config = JSON.parse(await readFile(file, 'utf8')) as {
      mcpServers: Record<string, Record<string, unknown>>
    }
    expect(Object.keys(config.mcpServers)).toEqual(['github', 'orkio'])
    expect(config.mcpServers['orkio']!['command']).toBe(process.execPath)
    expect(c.env['DEPLOY_TOKEN']).toBe('v2')
    expect(c.env['ANTHROPIC_API_KEY']).toBeUndefined()
    // O segredo do servidor vai só no arquivo do mcp-config (0600), nunca nos argumentos.
    expect(c.args.join(' ')).not.toContain('v1')
    expect(c.args.join(' ')).not.toContain('v2')
  })
})

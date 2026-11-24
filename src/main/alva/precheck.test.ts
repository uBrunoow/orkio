import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALVA_COMMANDS, alvaCommand } from '../../shared/alva'
import { makeTargets, parseMcpList, runPrecheck, type Exec } from './precheck'

let home: string
let project: string
let neutral: string
const ALL = ALVA_COMMANDS.map(alvaCommand)

interface Machine {
  mcpUser?: string
  mcpProject?: string
  gh?: 'missing' | 'logged_out' | 'ok'
  python?: boolean
  compose?: string | null
  dockerRunning?: boolean
}

function exec(m: Machine): Exec {
  return async (cmd, args, { cwd }) => {
    const key = `${cmd} ${args.join(' ')}`
    if (key === 'claude mcp list') {
      return {
        code: 0,
        stdout: (cwd === neutral ? m.mcpUser : m.mcpProject) ?? 'No MCP servers configured.'
      }
    }
    if (key === 'gh --version') {
      if (m.gh === 'missing') throw new Error('ENOENT')
      return { code: 0, stdout: 'gh version 2.60.0' }
    }
    if (key === 'gh auth status')
      return { code: m.gh === 'ok' ? 0 : 1, stdout: 'Token: gho_SEGREDO' }
    if (key === 'python3 --version') {
      if (m.python === false) throw new Error('ENOENT')
      return { code: 0, stdout: 'Python 3.12.1' }
    }
    if (key === 'docker compose version --short') {
      if (!m.compose) throw new Error('ENOENT')
      return { code: 0, stdout: `${m.compose}\n` }
    }
    if (key.startsWith('docker info'))
      return { code: m.dockerRunning === false ? 1 : 0, stdout: '27.0' }
    throw new Error(`inesperado: ${key}`)
  }
}

const OK_MCP =
  'backlog: backlog mcp start - ✔ Connected\nnotion: https://mcp.notion.com/mcp - ✔ Connected'

async function setupRepo(): Promise<void> {
  await mkdir(join(project, 'backlog', 'tasks'), { recursive: true })
  await writeFile(join(project, 'backlog', 'config.yml'), 'project_name: "x"\n')
  await writeFile(join(project, 'Makefile'), 'test:\n\tpytest\nlint:\n\truff check .\nFOO := 1\n')
  const plugin = join(home, '.claude', 'plugins', 'cache', 'alva-flow')
  await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(plugin, '.claude-plugin', 'plugin.json'),
    '{"name":"alva-flow","version":"1.0.25"}'
  )
  await writeFile(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'alva-flow@alva-flow-marketplace': [{ installPath: plugin }] } })
  )
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orkio-alva-home-'))
  project = await mkdtemp(join(tmpdir(), 'orkio-alva-proj-'))
  neutral = await mkdtemp(join(tmpdir(), 'orkio-alva-neutral-'))
})
afterEach(async () => {
  for (const d of [home, project, neutral]) await rm(d, { recursive: true, force: true })
})

const run = (m: Machine, commands = ALL) =>
  runPrecheck(project, commands, { exec: exec(m), neutralDir: neutral, home })
const state = (r: Awaited<ReturnType<typeof run>>) =>
  Object.fromEntries(r.items.map((i) => [i.id, i.state]))

describe('pré-checagem do alva-flow', () => {
  it('tudo certo: pronto, com a versão do plugin', async () => {
    await setupRepo()
    const r = await run({ mcpUser: OK_MCP, gh: 'ok' })
    expect(r.ready).toBe(true)
    expect(r.pluginVersion).toBe('1.0.25')
    expect(state(r)).toEqual({
      plugin: 'ok',
      backlog: 'ok',
      backlog_mcp: 'ok',
      gh: 'ok',
      python: 'ok',
      makefile: 'ok'
    })
    expect(JSON.stringify(r)).not.toContain('gho_SEGREDO')
    expect(JSON.stringify(r)).not.toContain('mcp.notion.com')
  })

  it('cada item faltando aparece com o que fazer', async () => {
    const r = await run({ gh: 'missing', python: false }, [])
    expect(r.ready).toBe(false)
    expect(state(r)).toEqual({
      plugin: 'missing',
      backlog: 'missing',
      backlog_mcp: 'missing',
      gh: 'missing',
      python: 'missing',
      makefile: 'missing'
    })
    expect(r.items.find((i) => i.id === 'backlog_mcp')!.fix).toBe(
      'claude mcp add backlog --scope user -- backlog mcp start'
    )
    expect(r.items.find((i) => i.id === 'plugin')!.fix).toContain('/plugin install alva-flow')
  })

  it('MCP só no projeto vira aviso (o worktree não vê); gh sem login; comandos faltando; Makefile sem lint', async () => {
    await setupRepo()
    await writeFile(join(project, 'Makefile'), 'test:\n\tpytest\n')
    const r = await run(
      {
        mcpProject: 'backlog: backlog mcp start - ⏸ Pending approval (run `claude` to approve)',
        gh: 'logged_out'
      },
      ALL.filter((c) => c !== 'alva-flow:pr')
    )
    expect(state(r)).toMatchObject({
      backlog_mcp: 'warning',
      gh: 'missing',
      plugin: 'missing',
      makefile: 'missing'
    })
    expect(r.items.find((i) => i.id === 'plugin')!.detail).toContain('/alva-flow:pr')
    expect(r.items.find((i) => i.id === 'makefile')!.detail).toContain('lint')
  })

  it('com docker compose: versão mínima 2.24.4 e Docker rodando', async () => {
    await setupRepo()
    await writeFile(join(project, 'docker-compose.yml'), 'services: {}\n')
    expect(state(await run({ mcpUser: OK_MCP, gh: 'ok', compose: '2.20.0' })).docker).toBe(
      'missing'
    )
    expect(
      state(await run({ mcpUser: OK_MCP, gh: 'ok', compose: '2.29.1', dockerRunning: false }))
        .docker
    ).toBe('missing')
    const ok = await run({ mcpUser: OK_MCP, gh: 'ok', compose: '2.29.1' })
    expect(ok.hasDocker).toBe(true)
    expect(state(ok).docker).toBe('ok')
  })

  it('parsers: mcp list só nome/status; targets do Makefile', () => {
    expect(parseMcpList(`${OK_MCP}\nruim: npx x - ✘ Failed to connect: 401\nlixo`)).toEqual([
      { name: 'backlog', status: 'ok' },
      { name: 'notion', status: 'ok' },
      { name: 'ruim', status: 'failed' }
    ])
    expect([...makeTargets('test: deps\nlint:\nVAR := x\n.PHONY: test\n')]).toEqual([
      'test',
      'lint',
      '.PHONY'
    ])
  })
})

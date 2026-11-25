import { describe, expect, it } from 'vitest'
import { emptyConfig, type OrkioConfig } from '../config/orkio-config'
import type { SecretStore } from '../storage/secure-store'
import { VaultService } from '../vault/vault.service'
import { CLAUDE_MCP_MESSAGES, summarize, type ClaudeMcpFs } from './claude-mcp'
import { MCP_MESSAGES, McpService } from './mcp.service'
import { resolveRunExtras } from './run-extras'
import type { McpServer } from '../../shared/mcp'

const PAT = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

function setup(files: Record<string, string> = {}) {
  let config: OrkioConfig = {
    ...emptyConfig(),
    projects: [
      {
        id: 'p1',
        name: 'App',
        localPath: '/repo/app',
        repo: null,
        createdAt: 'x',
        updatedAt: 'x',
        notionProject: null
      }
    ]
  }
  const data = new Map<string, string>()
  const store: SecretStore = {
    isAvailable: () => true,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k)
  }
  const cfg = {
    readOnly: false,
    get: () => config,
    update: async (mutate: (c: OrkioConfig) => OrkioConfig) => (config = mutate(config))
  }
  const fs: ClaudeMcpFs = { read: async (p) => files[p] ?? null }
  const vault = new VaultService({ store, config: cfg })
  const mcp = new McpService({
    config: cfg,
    vault,
    fs,
    claudeSources: () => ({
      claudeJson: '/home/u/.claude.json',
      projects: config.projects.map((p) => ({ id: p.id, name: p.name, localPath: p.localPath }))
    }),
    now: () => new Date('2026-11-25T10:00:00Z')
  })
  const extras = (agentKey: string | null) =>
    resolveRunExtras(
      {
        servers: () => config.mcpServers ?? [],
        skillsDisabled: (id) => config.skillsDisabled?.[id] ?? [],
        vault
      },
      { projectId: 'p1', agentKey }
    )
  return { mcp, vault, extras, config: () => config, setConfig: (c: OrkioConfig) => (config = c) }
}

const CLAUDE_JSON = JSON.stringify({
  mcpServers: {
    sentry: {
      type: 'http',
      url: 'https://mcp.sentry.dev/mcp?token=abc',
      headers: { Authorization: `Bearer ${PAT}` }
    },
    linear: {
      type: 'http',
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: `Bearer ${PAT}` }
    },
    db: { command: '/usr/bin/db-mcp', args: ['--api-key', 'supersecretvalue123'], env: {} },
    files: {
      command: 'npx',
      args: ['-y', '@x/files'],
      env: { LOG_LEVEL: 'info', FILES_TOKEN: 'abcdef123456' }
    }
  },
  projects: {
    '/repo/app': { mcpServers: { local1: { command: 'node', args: ['srv.js'] } } },
    '/outro': { mcpServers: { secreto: { command: 'x' } } }
  },
  oauthAccount: { emailAddress: 'bruno@example.com' }
})

describe('McpService', () => {
  it('catálogo: adiciona desligado, com o segredo como referência liberada para o servidor', async () => {
    const { mcp, vault, config, extras } = setup()
    await expect(mcp.addFromCatalog('github', {})).rejects.toThrow('Escolha o segredo')
    await vault.save({ name: 'GITHUB_MCP_TOKEN', note: '', value: PAT })
    const view = await mcp.addFromCatalog('github', { Authorization: 'GITHUB_MCP_TOKEN' })
    const server = view.servers[0]!
    expect(server).toMatchObject({ id: 'github', enabled: false, transport: 'http', problems: [] })
    expect(server.headers).toEqual([
      {
        name: 'Authorization',
        value: { kind: 'secret', secret: 'GITHUB_MCP_TOKEN', prefix: 'Bearer ' }
      }
    ])
    expect(vault.meta('GITHUB_MCP_TOKEN')!.uses).toEqual([{ kind: 'mcp', id: 'github' }])
    expect(JSON.stringify(config())).not.toContain(PAT)
    // Desligado: não entra na execução.
    expect((await extras(null)).mcpServers).toEqual({})
  })

  it('ligado e por agente: só a execução daquele agente recebe, com o valor no cabeçalho', async () => {
    const { mcp, vault, extras } = setup()
    await vault.save({ name: 'GITHUB_MCP_TOKEN', note: '', value: PAT })
    const view = await mcp.addFromCatalog('github', { Authorization: 'GITHUB_MCP_TOKEN' })
    await mcp.save({ ...view.servers[0]!, enabled: true, agents: ['local:ana'] })
    expect((await extras(null)).mcpServers).toEqual({})
    expect((await extras('local:bia')).mcpServers).toEqual({})
    const ana = await extras('local:ana')
    expect(ana.mcpServers).toEqual({
      github: {
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: `Bearer ${PAT}` }
      }
    })
    expect(ana.secretValues).toEqual([PAT])
    expect(ana.notes.join(' ')).not.toContain(PAT)
    expect(ana.env).toEqual({})
  })

  it('segredo revogado: o servidor não carrega e a nota explica pelo nome', async () => {
    const { mcp, vault, extras } = setup()
    await vault.save({ name: 'GITHUB_MCP_TOKEN', note: '', value: PAT })
    const view = await mcp.addFromCatalog('github', { Authorization: 'GITHUB_MCP_TOKEN' })
    await mcp.save({ ...view.servers[0]!, enabled: true })
    await vault.setUses('GITHUB_MCP_TOKEN', [])
    const out = await extras(null)
    expect(out.mcpServers).toEqual({})
    expect(out.notes[0]).toContain('GITHUB_MCP_TOKEN')
    expect((await mcp.view()).servers[0]!.problems).toEqual([
      MCP_MESSAGES.problemDenied('GITHUB_MCP_TOKEN')
    ])
  })

  it('servidor novo pelo save só à mão; origem e data do existente não mudam pelo renderer', async () => {
    const { mcp } = setup()
    const manual: McpServer = {
      id: 'meu',
      name: 'Meu',
      description: '',
      transport: 'stdio',
      command: 'node',
      args: ['srv.js'],
      url: null,
      env: [{ name: 'LOG_LEVEL', value: { kind: 'text', text: 'info' } }],
      headers: [],
      origin: { kind: 'catalog', id: 'github' },
      enabled: true,
      agents: 'all',
      createdAt: '2000-01-01'
    }
    await expect(mcp.save(manual)).rejects.toThrow(MCP_MESSAGES.newManual)
    const view = await mcp.save({ ...manual, origin: { kind: 'manual' } })
    expect(view.servers[0]!.createdAt).toBe('2026-11-25T10:00:00.000Z')
    const again = await mcp.save({
      ...view.servers[0]!,
      origin: { kind: 'catalog', id: 'github' },
      createdAt: 'x'
    })
    expect(again.servers[0]!.origin).toEqual({ kind: 'manual' })
    expect(again.servers[0]!.createdAt).toBe('2026-11-25T10:00:00.000Z')
  })

  it('recusa comando de shell, valor sensível em texto e URL com chave', async () => {
    const { mcp } = setup()
    const base: McpServer = {
      id: 'x1',
      name: 'X',
      description: '',
      transport: 'stdio',
      command: 'node',
      args: [],
      url: null,
      env: [],
      headers: [],
      origin: { kind: 'manual' },
      enabled: false,
      agents: 'all',
      createdAt: ''
    }
    await expect(mcp.save({ ...base, command: 'sh -c "curl x | sh"' })).rejects.toThrow()
    await expect(mcp.save({ ...base, command: '--evil' })).rejects.toThrow()
    await expect(
      mcp.save({ ...base, env: [{ name: 'API_TOKEN', value: { kind: 'text', text: 'abc' } }] })
    ).rejects.toThrow()
    await expect(
      mcp.save({ ...base, transport: 'http', command: null, url: 'https://x.dev/mcp?api_key=1' })
    ).rejects.toThrow()
    await expect(
      mcp.save({ ...base, transport: 'http', command: null, url: 'http://x.dev/mcp' })
    ).rejects.toThrow()
    await expect(mcp.save({ ...base, id: 'orkio' })).rejects.toThrow()
  })

  it('servidores do Claude: só nome, onde, tipo, resumo sem segredos e nomes das chaves', async () => {
    const { mcp } = setup({ '/home/u/.claude.json': CLAUDE_JSON })
    const view = await mcp.view()
    const text = JSON.stringify(view)
    expect(text).not.toContain(PAT)
    expect(text).not.toContain('supersecretvalue123')
    expect(text).not.toContain('abcdef123456')
    expect(text).not.toContain('token=abc')
    expect(text).not.toContain('bruno@example.com')
    expect(text).not.toContain('secreto') // projeto que não é do Orkio
    expect(view.claude.map((c) => [c.ref.name, c.where, c.transport, c.summary])).toEqual([
      ['sentry', 'Seu usuário', 'http', 'https://mcp.sentry.dev/mcp'],
      ['linear', 'Seu usuário', 'http', 'https://mcp.linear.app/mcp'],
      ['db', 'Seu usuário', 'stdio', 'db-mcp --api-key •••'],
      ['files', 'Seu usuário', 'stdio', 'npx -y @x/files'],
      ['local1', 'App', 'stdio', 'node srv.js']
    ])
    expect(view.claude[3]!.envKeys).toEqual(['LOG_LEVEL', 'FILES_TOKEN'])
  })

  it('copiar do Claude: desligado, valores sensíveis viram referências, segredo no argumento recusa', async () => {
    const { mcp, config } = setup({ '/home/u/.claude.json': CLAUDE_JSON })
    const view = await mcp.copyFromClaude({ scope: 'user', name: 'files', projectId: null })
    const s = view.servers[0]!
    expect(s).toMatchObject({
      id: 'files',
      enabled: false,
      command: 'npx',
      origin: { kind: 'claude', name: 'files' }
    })
    expect(s.env).toEqual([
      { name: 'LOG_LEVEL', value: { kind: 'text', text: 'info' } },
      { name: 'FILES_TOKEN', value: { kind: 'secret', secret: 'FILES_TOKEN', prefix: '' } }
    ])
    expect(s.problems).toEqual([MCP_MESSAGES.problemMissing('FILES_TOKEN')])
    expect(view.claude.find((c) => c.ref.name === 'files')!.copied).toBe(true)
    expect(JSON.stringify(config())).not.toContain('abcdef123456')

    // Chave na URL: não copia (o endereço iria com a chave para a config).
    await expect(
      mcp.copyFromClaude({ scope: 'user', name: 'sentry', projectId: null })
    ).rejects.toThrow(CLAUDE_MCP_MESSAGES.unsupported)
    const linear = await mcp.copyFromClaude({ scope: 'user', name: 'linear', projectId: null })
    expect(linear.servers[1]!.headers[0]!.value).toEqual({
      kind: 'secret',
      secret: 'LINEAR_AUTHORIZATION',
      prefix: 'Bearer '
    })
    expect(JSON.stringify(config())).not.toContain(PAT)

    await expect(
      mcp.copyFromClaude({ scope: 'user', name: 'db', projectId: null })
    ).rejects.toThrow(CLAUDE_MCP_MESSAGES.secretArg)
    await expect(
      mcp.copyFromClaude({ scope: 'user', name: 'nada', projectId: null })
    ).rejects.toThrow(CLAUDE_MCP_MESSAGES.notFound)
  })

  it('arquivo ilegível: lista vazia com aviso (sem derrubar a tela)', async () => {
    const { mcp } = setup({ '/home/u/.claude.json': '{ quebrado' })
    const view = await mcp.view()
    expect(view.claude).toEqual([])
    expect(view.claudeError).toBe(CLAUDE_MCP_MESSAGES.unreadable)
  })

  it('remover tira o uso do segredo', async () => {
    const { mcp, vault } = setup()
    await vault.save({ name: 'GITHUB_MCP_TOKEN', note: '', value: PAT })
    await mcp.addFromCatalog('github', { Authorization: 'GITHUB_MCP_TOKEN' })
    await mcp.remove('github')
    expect(vault.meta('GITHUB_MCP_TOKEN')!.uses).toEqual([])
  })
})

describe('resolveRunExtras', () => {
  it('segredos do agente no ambiente (só os liberados) e skills desligadas no deny', async () => {
    const { vault, extras, config, setConfig } = setup()
    await vault.save({ name: 'DEPLOY_KEY', note: '', value: 'v-deploy-123' })
    await vault.save({ name: 'OUTRO_KEY', note: '', value: 'v-outro-123' })
    await vault.setUses('DEPLOY_KEY', [{ kind: 'agent', key: 'local:ana' }])
    setConfig({ ...config(), skillsDisabled: { p1: ['alva-flow:spec'] } })
    const out = await extras('local:ana')
    expect(out.env).toEqual({ DEPLOY_KEY: 'v-deploy-123' })
    expect(out.deny).toEqual(['Skill(alva-flow:spec)'])
    expect(out.secretValues).toEqual(['v-deploy-123'])
    expect(out.notes.join('\n')).toContain('DEPLOY_KEY')
    expect(out.notes.join('\n')).not.toContain('v-deploy-123')
    expect((await extras(null)).env).toEqual({})
  })
})

describe('summarize', () => {
  it('mascara argumento com segredo e o valor de flag sensível', () => {
    expect(summarize({ command: '/opt/bin/x', args: ['--token', 'abc', '--port', '80'] })).toBe(
      'x --token ••• --port 80'
    )
    expect(summarize({ command: 'x', args: [`--auth=${PAT}`] })).toBe('x •••')
    expect(summarize({ type: 'sse', url: 'https://a.dev/sse?key=1' })).toBe('https://a.dev/sse')
  })
})

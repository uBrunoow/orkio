import { describe, expect, it } from 'vitest'
import { secretNameProblem, vaultStoreKey, parseSecretUses } from './vault'
import {
  MCP_CATALOG,
  freeMcpId,
  isMcpCommand,
  mcpLaunchText,
  mcpUrlProblem,
  parseMcpServer
} from './mcp'
import { parsePreferences } from './preferences'
import { parseClaudeMcpRef, parsePreferencesPatch, parseSecretSaveInput } from './ipc/payloads'
import { INVALID } from './ipc/define'

describe('vault', () => {
  it('nomes: variável de ambiente, sem reservados', () => {
    expect(secretNameProblem('GITHUB_TOKEN')).toBeNull()
    for (const bad of [
      'github',
      'PATH',
      'LD_PRELOAD',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ORKIO_X',
      'GIT_ASKPASS',
      '1ABC'
    ]) {
      expect(secretNameProblem(bad)).not.toBeNull()
    }
    expect(vaultStoreKey('GITHUB_MCP_TOKEN')).toBe('vault-github-mcp-token')
    expect(
      parseSecretUses([
        { kind: 'agent', key: 'local:ana' },
        { kind: 'agent', key: 'local:ana' }
      ])
    ).toEqual([{ kind: 'agent', key: 'local:ana' }])
    expect(parseSecretUses([{ kind: 'agent', key: '../x' }])).toBeNull()
  })
})

describe('mcp', () => {
  it('catálogo é válido pelo mesmo parser e nasce como "Vai rodar"/"Conecta em"', () => {
    for (const e of MCP_CATALOG) {
      expect(
        parseMcpServer({
          ...e,
          env: [],
          headers: [],
          origin: { kind: 'catalog', id: e.id },
          enabled: false,
          agents: 'all',
          createdAt: 'x'
        }),
        e.id
      ).not.toBeNull()
    }
    expect(
      mcpLaunchText({ transport: 'stdio', command: 'npx', args: ['-y', 'a'], url: null })
    ).toBe('Vai rodar: npx -y a')
  })
  it('comando nunca é linha de shell; URL sem chave/senha', () => {
    expect(isMcpCommand('npx')).toBe(true)
    expect(isMcpCommand('/usr/local/bin/x')).toBe(true)
    for (const bad of ['npx -y x', 'a;b', '$(x)', '-x', '../x', ''])
      expect(isMcpCommand(bad)).toBe(false)
    expect(mcpUrlProblem('https://a.dev/mcp')).toBeNull()
    expect(mcpUrlProblem('http://localhost:3000/mcp')).toBeNull()
    expect(mcpUrlProblem('https://u:p@a.dev')).not.toBeNull()
    expect(mcpUrlProblem('https://a.dev?apiKey=1')).not.toBeNull()
    expect(mcpUrlProblem('file:///etc/passwd')).not.toBeNull()
  })
  it('freeMcpId', () => {
    expect(freeMcpId('GitHub', [])).toBe('github')
    expect(freeMcpId('GitHub', ['github'])).toBe('github-2')
    expect(freeMcpId('orkio', [])).toBe('mcp-orkio')
    expect(freeMcpId('42', [])).toBe('mcp-42')
  })
})

describe('payloads da Fase 4', () => {
  it('segredo: só campos conhecidos', () => {
    expect(parseSecretSaveInput({ name: 'A_B', note: '', value: 'x', extra: 1 })).toEqual({
      name: 'A_B',
      note: '',
      value: 'x'
    })
    expect(parseSecretSaveInput({ name: 'a', note: '' })).toBe(INVALID)
    expect(parseSecretSaveInput({ name: 'A_B', note: '', value: 1 })).toBe(INVALID)
  })
  it('ref do Claude: escopo usuário sem projeto; local/projeto com projeto', () => {
    expect(parseClaudeMcpRef({ scope: 'user', name: 'x', projectId: null })).toEqual({
      scope: 'user',
      name: 'x',
      projectId: null
    })
    expect(parseClaudeMcpRef({ scope: 'local', name: 'x', projectId: null })).toBe(INVALID)
    expect(parseClaudeMcpRef({ scope: 'root', name: 'x', projectId: null })).toBe(INVALID)
  })
  it('preferências: patch só com chaves conhecidas e normalizado', () => {
    expect(parsePreferencesPatch({ autonomy: 'ask' })).toEqual({ autonomy: 'ask' })
    expect(parsePreferencesPatch({ hack: 1 })).toBe(INVALID)
    expect(parsePreferencesPatch({ model: '--dangerously' })).toEqual({ model: null })
    expect(
      parsePreferences({ notifications: { muted: ['p1', '../x', 'p1'] } }).notifications.muted
    ).toEqual(['p1'])
  })
})

import { describe, expect, it } from 'vitest'
import { secretNameProblem } from '../../../../shared/vault'
import type { McpServer } from '../../../../shared/mcp'
import {
  SECRET_SHORTCUTS,
  finalSecretName,
  secretUseLabel,
  serversUsingSecret,
  toSecretName,
  toggleUse
} from './secrets-logic'

describe('toSecretName', () => {
  it('vira nome de variável enquanto digita', () => {
    expect(toSecretName('github token')).toBe('GITHUB_TOKEN')
    expect(toSecretName('chave-da-api.prod')).toBe('CHAVE_DA_API_PROD')
    expect(toSecretName('ação ç')).toBe('ACAO_C')
    expect(toSecretName('github ')).toBe('GITHUB_')
    expect(toSecretName('x$%y')).toBe('XY')
    expect(toSecretName('a'.repeat(60))).toHaveLength(48)
  })
  it('finalSecretName tira _ das pontas e repetidos', () => {
    expect(finalSecretName(' github  token ')).toBe('GITHUB_TOKEN')
    expect(finalSecretName('__a__b__')).toBe('A_B')
  })
})

describe('usos', () => {
  it('liga e desliga sem repetir', () => {
    const a = { kind: 'agent', key: 'builtin:revisor' } as const
    const m = { kind: 'mcp', id: 'github' } as const
    expect(toggleUse([a], a, true)).toEqual([a])
    expect(toggleUse([a], m, true)).toEqual([a, m])
    expect(toggleUse([a, m], a, false)).toEqual([m])
  })
  it('rótulo pelo nome conhecido, senão pelo id', () => {
    const names = new Map([['builtin:revisor', 'Revisor']])
    expect(secretUseLabel({ kind: 'agent', key: 'builtin:revisor' }, names, [])).toBe('Revisor')
    expect(secretUseLabel({ kind: 'agent', key: 'repo:ana' }, names, [])).toBe('ana')
    expect(secretUseLabel({ kind: 'mcp', id: 'gh' }, names, [{ id: 'gh', name: 'GitHub' }])).toBe(
      'GitHub'
    )
    expect(secretUseLabel({ kind: 'mcp', id: 'x' }, names, [])).toBe('x')
  })
})

describe('serversUsingSecret', () => {
  const server = (id: string, secret: string): McpServer => ({
    id,
    name: id,
    description: '',
    transport: 'stdio',
    command: 'npx',
    args: [],
    url: null,
    env: [{ name: 'TOKEN', value: { kind: 'secret', secret, prefix: '' } }],
    headers: [],
    origin: { kind: 'manual' },
    enabled: false,
    agents: 'all',
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  it('acha os servidores que referenciam o segredo', () => {
    const list = [server('a', 'A_TOKEN'), server('b', 'B_TOKEN')]
    expect(serversUsingSecret(list, 'A_TOKEN').map((s) => s.id)).toEqual(['a'])
  })
})

describe('atalhos', () => {
  it('usam o nome sugerido do catálogo, que é válido', () => {
    expect(SECRET_SHORTCUTS.map((s) => s.label)).toEqual([
      'Token do GitHub para o MCP',
      'Token do Notion para o MCP'
    ])
    for (const s of SECRET_SHORTCUTS) expect(secretNameProblem(s.name)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { McpServer } from '../../../../shared/mcp'
import {
  argsFromText,
  bindingProblem,
  checkDraft,
  draftFromServer,
  draftHasProblems,
  emptyBinding,
  emptyDraft,
  serverFromDraft,
  toggleAgent
} from './mcp-logic'

const base = {
  id: 'meu',
  origin: { kind: 'manual' } as const,
  enabled: false,
  agents: 'all' as const,
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('rascunho ↔ servidor', () => {
  it('stdio com argumentos por linha e variável com segredo', () => {
    const d = {
      ...emptyDraft(),
      name: ' Meu ',
      command: 'npx',
      argsText: '-y\n\n  @pacote/mcp  \n',
      env: [{ ...emptyBinding(), name: 'API_KEY', kind: 'secret' as const, secret: 'MEU_TOKEN' }]
    }
    expect(draftHasProblems(checkDraft(d))).toBe(false)
    const s = serverFromDraft(d, base)
    expect(s).toMatchObject({
      name: 'Meu',
      command: 'npx',
      args: ['-y', '@pacote/mcp'],
      url: null,
      env: [{ name: 'API_KEY', value: { kind: 'secret', secret: 'MEU_TOKEN', prefix: '' } }]
    })
    expect(draftFromServer(s as McpServer).argsText).toBe('-y\n@pacote/mcp')
  })

  it('http com cabeçalho Bearer', () => {
    const d = {
      ...emptyDraft(),
      name: 'Remoto',
      transport: 'http' as const,
      url: 'https://exemplo.com/mcp',
      headers: [
        {
          ...emptyBinding(),
          name: 'Authorization',
          kind: 'secret' as const,
          secret: 'GH_TOKEN',
          prefix: 'Bearer '
        }
      ]
    }
    expect(draftHasProblems(checkDraft(d))).toBe(false)
    const s = serverFromDraft(d, base)
    expect(s?.headers[0]?.value).toEqual({ kind: 'secret', secret: 'GH_TOKEN', prefix: 'Bearer ' })
    expect(s?.command).toBeNull()
  })

  it('aponta os problemas por campo', () => {
    const c = checkDraft({ ...emptyDraft(), command: 'npx -y pacote' })
    expect(c.name).toBe('Dê um nome.')
    expect(c.command).toMatch(/Só o nome do programa/)
    const h = checkDraft({
      ...emptyDraft(),
      name: 'x',
      transport: 'http',
      url: 'http://exemplo.com'
    })
    expect(h.url).toMatch(/https/)
    const dup = checkDraft({
      ...emptyDraft(),
      name: 'x',
      command: 'npx',
      env: [
        { ...emptyBinding(), name: 'A', text: '1' },
        { ...emptyBinding(), name: 'a', text: '2' }
      ]
    })
    expect(dup.general).toBe('Há nomes repetidos.')
  })

  it('nome sensível só aceita segredo', () => {
    expect(bindingProblem({ ...emptyBinding(), name: 'API_TOKEN', text: 'abc' }, 'env')).toMatch(
      /segredo/
    )
    expect(bindingProblem({ ...emptyBinding(), name: 'REGION', text: 'sa' }, 'env')).toBeNull()
    expect(bindingProblem({ ...emptyBinding(), name: 'API_TOKEN', kind: 'secret' }, 'env')).toBe(
      'Escolha um segredo.'
    )
    expect(bindingProblem({ ...emptyBinding(), name: 'X_Y', text: '' }, 'header')).toMatch(
      /cabeçalho/
    )
  })
})

describe('auxiliares', () => {
  it('argsFromText ignora linhas vazias', () => {
    expect(argsFromText('a\r\n\n b c \n')).toEqual(['a', 'b c'])
  })
  it('toggleAgent', () => {
    expect(toggleAgent(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleAgent(['a', 'b'], 'a', false)).toEqual(['b'])
  })
})

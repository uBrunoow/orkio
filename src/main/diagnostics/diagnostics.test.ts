import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db/database'
import { collectDiagnostics, type DiagnosticsDeps } from './diagnostics'

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

function deps(overrides: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps {
  return {
    app: { version: '0.2.1', packaged: false },
    runtime: { electron: '45.4.1', node: '24.0.0', chrome: '140' },
    os: { platform: 'linux', arch: 'x64', release: '6.17.0' },
    config: { schemaVersion: 11, readOnly: false },
    db: openDatabase(':memory:'),
    connections: async () => [
      {
        name: 'GitHub',
        status: {
          state: 'connected',
          account: { userName: 'Pessoa Secreta', handle: 'pessoa-secreta', workspaceName: SECRET },
          connectedAt: '2026-11-01T00:00:00Z'
        }
      },
      { name: 'Notion', status: { state: 'error', message: `falhou com ${SECRET}` } }
    ],
    toolVersion: async (cmd) => (cmd === 'gh' ? null : `${cmd} version 1.0`),
    countEntries: async () => 2,
    projects: () => ({ total: 3, withBoard: 1 }),
    automation: () => ({ polling: 1, failing: 0 }),
    now: () => new Date('2026-11-23T12:00:00Z'),
    ...overrides
  }
}

describe('collectDiagnostics', () => {
  it('traz versões, banco, filas e conexões só pelo estado', async () => {
    const text = await collectDiagnostics(deps())
    expect(text).toContain('# Diagnóstico do Orkio')
    expect(text).toContain('- Versão: 0.2.1')
    expect(text).toMatch(/- Banco local: v\d+/)
    expect(text).toContain('- Integridade do banco: ok')
    expect(text).toContain('- Escritas pendentes no Notion: 0')
    expect(text).toContain('- GitHub: conectado')
    expect(text).toContain('- Notion: erro')
    expect(text).toContain('- gh: não encontrado')
    expect(text).toContain('- Projetos com quadro: 1')
  })

  it('nunca inclui conta, mensagem de erro nem token', async () => {
    const text = await collectDiagnostics(deps())
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('Pessoa Secreta')
    expect(text).not.toContain('pessoa-secreta')
    expect(text).not.toContain('falhou com')
  })

  it('sem banco e com ferramentas quebradas, ainda gera o texto', async () => {
    const text = await collectDiagnostics(
      deps({
        db: null,
        toolVersion: async () => {
          throw new Error('boom')
        },
        countEntries: async () => null
      })
    )
    expect(text).toContain('- Banco local: indisponível')
    expect(text).toContain('- git: não encontrado')
    expect(text).toContain('- Pastas de trabalho (worktrees): —')
  })
})

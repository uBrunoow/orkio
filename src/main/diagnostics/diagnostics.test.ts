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
    flows: { counts: () => ({ total: 4, active: 1 }) },
    runs: { counts: () => ({ total: 7, active: 2 }) },
    board: {
      counts: () => ({ events: 12, pendingWrites: 5 }),
      stuckWrites: (min) => (min === 3 ? [{}, {}] : [])
    },
    gitFlow: { pendingCount: () => 3 },
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
    paths: { worktrees: '/ud/worktrees', runs: '/ud/runs' },
    listDir: async (dir) =>
      ({
        '/ud/worktrees': ['p1', 'p2'],
        '/ud/worktrees/p1': ['ORK-1', 'ORK-2'],
        '/ud/worktrees/p2': ['ORK-3'],
        '/ud/runs': ['a.jsonl', 'b.jsonl']
      })[dir] ?? [],
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
    // Contagens pelos donos das tabelas (quadro e execuções).
    expect(text).toContain('- Escritas pendentes no Notion: 5')
    expect(text).toContain('- Escritas pendentes da Etapa Git: 3')
    expect(text).toContain('- Escritas com 3+ tentativas: 2')
    expect(text).toContain('- Eventos de tarefas: 12')
    expect(text).toContain('- Execuções do Claude Code: 7')
    expect(text).toContain('- Claude Code rodando ou na fila: 2')
    expect(text).toContain('- GitHub: conectado')
    expect(text).toContain('- Notion: erro')
    expect(text).toContain('- gh: não encontrado')
    expect(text).toContain('- Projetos com quadro: 1')
    // Contagem pelas pastas de `userDataPaths()`: worktrees por projeto, logs das execuções.
    expect(text).toContain('- Pastas de trabalho (worktrees): 3')
    expect(text).toContain('- Logs de execução: 2')
    // Fluxos contados pelo executor (dono da tabela).
    expect(text).toContain('- Execuções de fluxo: 4')
    expect(text).toContain('- Fluxos em andamento: 1')
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
        flows: null,
        runs: null,
        board: null,
        toolVersion: async () => {
          throw new Error('boom')
        },
        listDir: async () => {
          throw new Error('ENOENT')
        }
      })
    )
    expect(text).toContain('- Banco local: indisponível')
    expect(text).toContain('- git: não encontrado')
    expect(text).toContain('- Pastas de trabalho (worktrees): 0')
  })
})

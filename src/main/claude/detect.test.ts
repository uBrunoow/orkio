import { describe, expect, it } from 'vitest'
import { CLAUDE_EFFORT_VERSION } from '../../shared/agent-runtime'
import { detectClaude, supportsEffortVersion, type ExecFileFn } from './detect'

/** A versão logo abaixo (último número − 1, ou o anterior com o resto zerado em 999). */
function justBelow(version: string): string {
  const parts = version.split('.').map(Number)
  const i = parts.findLastIndex((n) => n > 0)
  return parts.map((n, j) => (j < i ? n : j === i ? n - 1 : 999)).join('.')
}

describe('supportsEffortVersion', () => {
  it('a partir de CLAUDE_EFFORT_VERSION (sem versão conhecida, não)', () => {
    expect(supportsEffortVersion(CLAUDE_EFFORT_VERSION)).toBe(true)
    expect(supportsEffortVersion(justBelow(CLAUDE_EFFORT_VERSION))).toBe(false)
    const [major] = CLAUDE_EFFORT_VERSION.split('.')
    expect(supportsEffortVersion(`${Number(major) + 1}.0.0`)).toBe(true)
    expect(supportsEffortVersion(null)).toBe(false)
  })
})

/** `claude --version` e `claude auth status` simulados (erro = objeto com `code`/`stdout`). */
function fakeCli(
  version: { stdout: string } | Error,
  auth: { stdout: string } | (Error & { code?: number; stdout?: string })
): ExecFileFn {
  return async (_file, args) => {
    const r = args[0] === '--version' ? version : auth
    if (r instanceof Error) throw r
    return { stdout: r.stdout, stderr: '' }
  }
}

const exitError = (code: number, stdout = ''): Error & { code: number; stdout: string } =>
  Object.assign(new Error('exit'), { code, stdout })

describe('detectClaude', () => {
  it('não instalado (o --version falha): nada mais é consultado', async () => {
    const s = await detectClaude({
      execFile: fakeCli(new Error('ENOENT'), { stdout: '' }),
      env: {}
    })
    expect(s).toMatchObject({ installed: false, version: null, loggedIn: null })
  })

  it('lê a versão da saída do --version e o login pelo JSON do auth status', async () => {
    const s = await detectClaude({
      execFile: fakeCli(
        { stdout: `${CLAUDE_EFFORT_VERSION} (Claude Code)\n` },
        { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c' }) }
      ),
      env: {}
    })
    expect(s).toMatchObject({
      installed: true,
      version: CLAUDE_EFFORT_VERSION,
      loggedIn: true,
      authMethod: 'claude.ai',
      meetsMinimum: true,
      supportsEffort: true
    })
    expect(JSON.stringify(s)).not.toContain('a@b.c')
  })

  it('exit 1 do auth status = não logado (mesmo sem JSON)', async () => {
    const s = await detectClaude({
      execFile: fakeCli({ stdout: CLAUDE_EFFORT_VERSION }, exitError(1)),
      env: {}
    })
    expect(s).toMatchObject({ installed: true, loggedIn: false })
  })

  it('exit 0 sem JSON = logado; versão antiga não passa do mínimo nem aceita --effort', async () => {
    const s = await detectClaude({
      execFile: fakeCli({ stdout: '0.1.0' }, { stdout: 'ok' }),
      env: {}
    })
    expect(s).toMatchObject({
      installed: true,
      loggedIn: true,
      meetsMinimum: false,
      supportsEffort: false
    })
  })
})

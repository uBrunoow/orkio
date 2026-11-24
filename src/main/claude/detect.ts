/**
 * Detecção do Claude Code instalado (Etapa 4A): `claude --version` e `claude auth status` (JSON).
 * Lemos só a versão e o tipo de autenticação; nunca e-mail, organização ou token.
 */
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CLAUDE_MIN_VERSION, type ClaudeCodeStatus } from '../../shared/agent-run'
import { CLAUDE_EFFORT_VERSION } from '../../shared/agent-runtime'
import { sanitizeEnv } from '../platform/redact'

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; env: NodeJS.ProcessEnv; windowsHide: boolean; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function supportsEffortVersion(version: string | null): boolean {
  return version !== null && compareVersions(version, CLAUDE_EFFORT_VERSION) >= 0
}

export async function detectClaude(
  deps: { execFile?: ExecFileFn; command?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<ClaudeCodeStatus> {
  const run: ExecFileFn = deps.execFile ?? (promisify(nodeExecFile) as unknown as ExecFileFn)
  const command = deps.command ?? 'claude'
  const options = {
    timeout: 15_000,
    env: sanitizeEnv(deps.env ?? process.env),
    windowsHide: true,
    maxBuffer: 1024 * 1024
  }
  const base: ClaudeCodeStatus = {
    installed: false,
    version: null,
    loggedIn: null,
    authMethod: null,
    meetsMinimum: false,
    minimumVersion: CLAUDE_MIN_VERSION,
    supportsEffort: false
  }

  let version: string | null
  try {
    const { stdout } = await run(command, ['--version'], options)
    version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null
  } catch {
    return base
  }

  let loggedIn: boolean | null = null
  let authMethod: string | null = null
  const read = (stdout: string): void => {
    try {
      const data = JSON.parse(stdout) as Record<string, unknown>
      const method = typeof data['authMethod'] === 'string' ? data['authMethod'] : null
      authMethod = method
      loggedIn =
        typeof data['loggedIn'] === 'boolean'
          ? data['loggedIn']
          : method !== null && method !== 'none'
    } catch {
      loggedIn = null
    }
  }
  try {
    const { stdout } = await run(command, ['auth', 'status'], options)
    read(stdout)
    if (loggedIn === null) loggedIn = true // exit 0 = logado (doc)
  } catch (e) {
    // Exit 1 = não logado; o JSON ainda pode vir no stdout.
    const stdout = (e as { stdout?: unknown }).stdout
    if (typeof stdout === 'string' && stdout.trim()) read(stdout)
    if ((e as { code?: unknown }).code === 1) loggedIn = false
  }

  return {
    ...base,
    installed: true,
    version,
    loggedIn,
    authMethod,
    meetsMinimum: version !== null && compareVersions(version, CLAUDE_MIN_VERSION) >= 0,
    supportsEffort: supportsEffortVersion(version)
  }
}

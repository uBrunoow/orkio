import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { sanitizeEnv } from './redact'

/**
 * Apps abertos pelo Finder/menu não herdam o PATH do terminal: acrescenta as pastas usuais do
 * Claude Code e dos editores (instalador nativo, npm global, Homebrew).
 */
export function toolEnv(): NodeJS.ProcessEnv {
  const home = homedir()
  const extra = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ]
  const current = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  const path = [...current, ...extra.filter((d) => !current.includes(d))].join(delimiter)
  return { ...process.env, PATH: path }
}

export interface ExecResult {
  /** 0 = sucesso; outro valor (ou 1, quando o erro não traz código, ex.: timeout) = falhou. */
  code: number
  stdout: string
  stderr: string
}

/**
 * Roda um comando (execFile, nunca shell) e devolve o código de saída: comando ausente REJEITA
 * (ENOENT); código ≠ 0 RESOLVE com o código (quem chama decide o que importa). Com `env`, ele passa
 * por `sanitizeEnv` (sem segredos do ambiente do app).
 */
export function execExitCode(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer?: number }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: sanitizeEnv(options.env) } : {}),
        timeout: options.timeoutMs,
        windowsHide: true,
        ...(options.maxBuffer ? { maxBuffer: options.maxBuffer } : {})
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(error)
        else
          resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: String(stdout),
            stderr: String(stderr)
          })
      }
    )
  })
}

/** Abre um programa solto do Orkio (terminal, editor): sem shell, sem saída, sem esperar. */
export function spawnDetached(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; windowsHide: boolean }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: options.windowsHide,
      env: options.env
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

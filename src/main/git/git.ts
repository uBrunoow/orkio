/**
 * Acesso ao git local. SEMPRE via execFile('git', [args]) com cwd e timeout — nunca exec com
 * string (sem shell, sem interpolação de caminhos). Erros viram GitError com mensagem pt-BR.
 */
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

export const GIT_TIMEOUT_MS = 10_000

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: {
    cwd: string
    timeout: number
    env: NodeJS.ProcessEnv
    maxBuffer: number
    windowsHide: boolean
  }
) => Promise<{ stdout: string; stderr: string }>

export type GitErrorCode =
  'git_not_found' | 'not_a_repo' | 'dubious_ownership' | 'folder_not_found' | 'timeout' | 'failed'

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitRemote {
  name: string
  /** URL de fetch. */
  url: string
}

export interface Git {
  /** Raiz do repositório que contém `dir` (resolve subpastas). */
  showToplevel(dir: string): Promise<string>
  /** Diretório git real (onde fica o HEAD); em worktrees, `.git` é um arquivo e isso resolve o caminho. */
  absoluteGitDir(root: string): Promise<string>
  remotes(root: string): Promise<GitRemote[]>
  /** Branch atual; `null` em detached HEAD. */
  currentBranch(root: string): Promise<string | null>
  /** Há mudanças não commitadas (inclui arquivos novos)? */
  isDirty(root: string): Promise<boolean>
  /** Branch padrão conhecida localmente (refs/remotes/<remote>/HEAD), se houver. */
  remoteDefaultBranch(root: string, remote: string): Promise<string | null>
  /** Nomes das branches locais (refs/heads). */
  localBranches(root: string): Promise<string[]>
}

export function createGit(deps: { execFile?: ExecFileFn; timeoutMs?: number } = {}): Git {
  const execFileImpl: ExecFileFn =
    deps.execFile ?? (promisify(nodeExecFile) as unknown as ExecFileFn)
  const timeout = deps.timeoutMs ?? GIT_TIMEOUT_MS

  async function git(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileImpl('git', args, {
        cwd,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          // Nunca pedir credenciais/editor; saída estável em inglês; sem travar o índice.
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
          LANG: 'C'
        }
      })
      return stdout
    } catch (error) {
      throw toGitError(error)
    }
  }

  return {
    async showToplevel(dir) {
      return (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
    },
    async absoluteGitDir(root) {
      return (await git(root, ['rev-parse', '--absolute-git-dir'])).trim()
    },
    async remotes(root) {
      return parseRemotes(await git(root, ['remote', '-v']))
    },
    async currentBranch(root) {
      const branch = (await git(root, ['branch', '--show-current'])).trim()
      return branch === '' ? null : branch
    },
    async isDirty(root) {
      return (await git(root, ['status', '--porcelain'])).trim() !== ''
    },
    async localBranches(root) {
      const out = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      return out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    },
    async remoteDefaultBranch(root, remote) {
      try {
        const ref = (
          await git(root, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`])
        ).trim()
        return ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : null
      } catch {
        return null
      }
    }
  }
}

/** `git remote -v` → um item por remote (URL de fetch). */
export function parseRemotes(output: string): GitRemote[] {
  const remotes = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const [, name, url, kind] = match
    if (kind === 'fetch' || !remotes.has(name!)) remotes.set(name!, url!)
  }
  return [...remotes].map(([name, url]) => ({ name, url }))
}

export function toGitError(error: unknown): GitError {
  if (error instanceof GitError) return error
  const e = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string }
  if (e?.code === 'ENOENT' && e.syscall?.startsWith('spawn')) {
    return new GitError(
      'git_not_found',
      'O git não foi encontrado no PATH. Instale o git e reinicie o Orkio.'
    )
  }
  if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') {
    return new GitError('folder_not_found', 'A pasta não existe mais.')
  }
  if (e?.killed || e?.signal === 'SIGTERM') {
    return new GitError('timeout', 'O git demorou demais para responder nesta pasta.')
  }
  const stderr = typeof e?.stderr === 'string' ? e.stderr : ''
  if (/not a git repository/i.test(stderr)) {
    return new GitError('not_a_repo', 'Esta pasta não é um repositório git.')
  }
  if (/dubious ownership/i.test(stderr)) {
    return new GitError(
      'dubious_ownership',
      'O git recusou esta pasta por ser de outro usuário (safe.directory). Ajuste a permissão ou rode “git config --global --add safe.directory <pasta>”.'
    )
  }
  return new GitError('failed', 'O git retornou um erro ao ler esta pasta.')
}

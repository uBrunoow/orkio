import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseRemoteUrl } from '../projects/remote-url'
import { GitError, createGit, parseRemotes, type ExecFileFn } from './git'

function execError(props: Record<string, unknown>): Error {
  return Object.assign(new Error('exec failed'), props)
}

describe('createGit com execFile simulado', () => {
  it('usa execFile("git", args, { cwd, timeout }) — nunca shell', async () => {
    const execFile = vi.fn<ExecFileFn>(async () => ({ stdout: '/repo\n', stderr: '' }))
    await createGit({ execFile, timeoutMs: 1234 }).showToplevel('/repo/sub')

    const [file, args, options] = execFile.mock.calls[0]!
    expect(file).toBe('git')
    expect(args).toEqual(['rev-parse', '--show-toplevel'])
    expect(options).toMatchObject({ cwd: '/repo/sub', timeout: 1234 })
    expect(options.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' })
    expect(options).not.toHaveProperty('shell')
  })

  it('git ausente no PATH → git_not_found', async () => {
    const git = createGit({
      execFile: async () => {
        throw execError({ code: 'ENOENT', syscall: 'spawn git', path: 'git' })
      }
    })
    await expect(git.showToplevel('/x')).rejects.toMatchObject({
      code: 'git_not_found',
      message: expect.stringContaining('PATH')
    })
  })

  it('pasta que não é repositório → not_a_repo', async () => {
    const git = createGit({
      execFile: async () => {
        throw execError({
          code: 128,
          stderr: 'fatal: not a git repository (or any of the parent directories): .git\n'
        })
      }
    })
    await expect(git.showToplevel('/x')).rejects.toMatchObject({ code: 'not_a_repo' })
  })

  it('cwd inexistente → folder_not_found', async () => {
    const git = createGit({
      execFile: async () => {
        throw execError({ code: 'ENOENT', syscall: 'uv_cwd' })
      }
    })
    await expect(git.showToplevel('/sumiu')).rejects.toMatchObject({ code: 'folder_not_found' })
  })

  it('timeout → timeout', async () => {
    const git = createGit({
      execFile: async () => {
        throw execError({ killed: true, signal: 'SIGTERM' })
      }
    })
    await expect(git.isDirty('/x')).rejects.toMatchObject({ code: 'timeout' })
  })

  it('dubious ownership → mensagem com safe.directory', async () => {
    const git = createGit({
      execFile: async () => {
        throw execError({
          code: 128,
          stderr: "fatal: detected dubious ownership in repository at '/x'"
        })
      }
    })
    await expect(git.showToplevel('/x')).rejects.toMatchObject({
      code: 'dubious_ownership',
      message: expect.stringContaining('safe.directory')
    })
  })

  it('outro erro → failed, sem repassar o stderr cru', async () => {
    const git = createGit({
      execFile: async () => {
        throw execError({ code: 1, stderr: 'segredo interno /home/x' })
      }
    })
    const error = await git.remotes('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitError)
    expect((error as Error).message).not.toContain('segredo')
  })

  it('branch vazia (detached HEAD) → null; status vazio → limpo', async () => {
    const git = createGit({ execFile: async () => ({ stdout: '\n', stderr: '' }) })
    expect(await git.currentBranch('/x')).toBeNull()
    expect(await git.isDirty('/x')).toBe(false)
  })

  it('status com saída → sujo', async () => {
    const git = createGit({
      execFile: async () => ({ stdout: ' M src/a.ts\n?? novo.txt\n', stderr: '' })
    })
    expect(await git.isDirty('/x')).toBe(true)
  })
})

describe('parseRemotes', () => {
  it('um item por remote, preferindo a URL de fetch', () => {
    expect(
      parseRemotes(
        [
          'origin\tgit@github.com:me/fork.git (fetch)',
          'origin\tgit@github.com:me/fork.git (push)',
          'upstream\thttps://github.com/acme/app.git (fetch)',
          'upstream\tDISABLE (push)',
          ''
        ].join('\n')
      )
    ).toEqual([
      { name: 'origin', url: 'git@github.com:me/fork.git' },
      { name: 'upstream', url: 'https://github.com/acme/app.git' }
    ])
    expect(parseRemotes('')).toEqual([])
  })
})

/** Integração com o git de verdade (repositórios temporários). */
describe('createGit com git real', () => {
  let dir: string
  let repo: string
  const git = createGit()
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString()

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'orkio-git-')))
    repo = join(dir, 'app')
    await mkdir(join(repo, 'src', 'deep'), { recursive: true })
    run(repo, 'init', '-q', '-b', 'main')
    run(repo, 'config', 'user.email', 'e2e@example.com')
    run(repo, 'config', 'user.name', 'E2E')
    await writeFile(join(repo, 'README.md'), '# app\n')
    run(repo, 'add', '.')
    run(repo, 'commit', '-q', '-m', 'init')
    run(repo, 'remote', 'add', 'origin', 'git@github.com:acme/app.git')
    run(repo, 'remote', 'add', 'upstream', 'https://github.com/upstream-org/app.git')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('subpasta resolve para a raiz', async () => {
    expect(await git.showToplevel(join(repo, 'src', 'deep'))).toBe(repo)
  })

  it('remotes, branch e sujeira', async () => {
    // Comparamos o repositório, não a string: um `url.insteadOf` global (comum) reescreve
    // git@github.com: para https:// na saída de `git remote -v`.
    const remotes = await git.remotes(repo)
    expect(remotes.map((r) => r.name)).toEqual(['origin', 'upstream'])
    expect(remotes.map((r) => parseRemoteUrl(r.url))).toEqual([
      expect.objectContaining({ owner: 'acme', name: 'app', kind: 'github' }),
      expect.objectContaining({ owner: 'upstream-org', name: 'app', kind: 'github' })
    ])
    expect(await git.currentBranch(repo)).toBe('main')
    expect(await git.isDirty(repo)).toBe(false)
    await writeFile(join(repo, 'novo.txt'), 'x')
    expect(await git.isDirty(repo)).toBe(true)
    await rm(join(repo, 'novo.txt'))
  })

  it('pasta fora de repositório → not_a_repo', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'orkio-not-repo-'))
    try {
      await expect(git.showToplevel(outside)).rejects.toMatchObject({ code: 'not_a_repo' })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('worktree: .git é um arquivo e absoluteGitDir aponta para o diretório certo', async () => {
    const wt = join(dir, 'app-wt')
    run(repo, 'worktree', 'add', '-q', '-b', 'feature/x', wt)
    expect(await git.showToplevel(wt)).toBe(wt)
    expect(await git.currentBranch(wt)).toBe('feature/x')
    const gitDir = await git.absoluteGitDir(wt)
    expect(gitDir).toBe(join(repo, '.git', 'worktrees', 'app-wt'))
  })

  it('detached HEAD → null', async () => {
    run(repo, 'checkout', '-q', '--detach')
    expect(await git.currentBranch(repo)).toBeNull()
    run(repo, 'checkout', '-q', 'main')
  })
})

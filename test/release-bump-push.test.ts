import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/release-bump-push.sh contra uma origem local: a main andou depois do checkout (o que
 * derrubou o release da v0.2.1) e o push recusado uma vez. Precisa de bash e git.
 */
const ROOT = join(import.meta.dirname, '..')
const FILES = [
  'scripts/release.mjs',
  'scripts/release-lib.mts',
  'scripts/release-bump-push.sh',
  'src/shared/changelog.mts'
]
const CHANGELOG = '# Changelog\n\n## [Não lançado]\n\n### Corrigido\n\n- Algo corrigido.\n'
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_TERMINAL_PROMPT: '0'
}

let dir: string
let origin: string
let work: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function clone(name: string): string {
  const path = join(dir, name)
  git(dir, 'clone', '-q', origin, path)
  return path
}

function runScript(cwd: string, kind: string, version: string): string {
  return execFileSync('bash', ['scripts/release-bump-push.sh', kind, version], {
    cwd,
    env: ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orkio-release-'))
  origin = join(dir, 'origin.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  work = join(dir, 'seed')
  mkdirSync(work)
  git(work, 'init', '-q', '-b', 'main')
  git(work, 'remote', 'add', 'origin', origin)
  writeFileSync(join(work, 'package.json'), '{\n  "name": "x",\n  "version": "0.1.0"\n}\n')
  writeFileSync(join(work, 'CHANGELOG.md'), CHANGELOG)
  mkdirSync(join(work, 'scripts'))
  mkdirSync(join(work, 'src', 'shared'), { recursive: true })
  for (const f of FILES) copyFileSync(join(ROOT, f), join(work, f))
  chmodSync(join(work, 'scripts', 'release-bump-push.sh'), 0o755)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'inicial')
  git(work, 'push', '-q', 'origin', 'main')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('release-bump-push.sh', () => {
  it('checkout atrasado (outra PR entrou na main): a versão sai em cima da main nova', () => {
    const stale = clone('stale') // o job começou aqui
    const other = clone('other') // outra PR mergeada logo depois
    writeFileSync(join(other, 'outra.txt'), 'x')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'outra PR')
    git(other, 'push', '-q', 'origin', 'main')

    runScript(stale, 'patch', '0.1.1')

    const log = git(origin, 'log', '--format=%s', 'main').trim().split('\n')
    expect(log.slice(0, 2)).toEqual(['chore(release): v0.1.1', 'outra PR'])
    expect(git(origin, 'tag').trim()).toBe('v0.1.1')
    expect(git(origin, 'show', 'main:package.json')).toContain('"version": "0.1.1"')
    expect(git(origin, 'show', 'main:CHANGELOG.md')).toContain('## [0.1.1]')
  })

  it('push recusado uma vez: refaz em cima da main e conclui', () => {
    // Hook da origem: recusa o primeiro push e aceita os seguintes.
    const hook = join(origin, 'hooks', 'pre-receive')
    writeFileSync(
      hook,
      `#!/bin/sh\nif [ ! -e "${join(dir, 'recusou')}" ]; then touch "${join(dir, 'recusou')}"; echo recusado >&2; exit 1; fi\nexit 0\n`
    )
    chmodSync(hook, 0o755)
    const job = clone('job')
    const out = runScript(job, 'minor', '0.2.0')
    expect(existsSync(join(dir, 'recusou'))).toBe(true)
    expect(out).toContain('tentativa 2')
    expect(git(origin, 'tag').trim()).toBe('v0.2.0')
    // Um só commit de versão (a tentativa recusada não deixou lixo).
    const releases = git(origin, 'log', '--format=%s', 'main')
      .split('\n')
      .filter((s) => s.startsWith('chore(release)'))
    expect(releases).toEqual(['chore(release): v0.2.0'])
  })

  it('a versão que saiu é diferente da planejada: para sem empurrar nada', () => {
    const job = clone('job')
    expect(() => runScript(job, 'minor', '9.9.9')).toThrow()
    expect(git(origin, 'tag').trim()).toBe('')
    expect(git(origin, 'log', '--format=%s', 'main').trim()).toBe('inicial')
  })
})

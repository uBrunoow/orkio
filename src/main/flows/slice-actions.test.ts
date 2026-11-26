import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGit } from '../git/git'
import { nextSlices, sliceDeps, slicesDone, sliceWaves } from '../../shared/slices'
import { createSliceActions } from './slice-actions'

let dir: string
const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t'
    }
  }).toString()
const commit = (file: string, message: string): void => {
  writeFileSync(join(dir, file), file)
  git('add', file)
  git('commit', '-q', '-m', message)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orkio-slices-'))
  git('init', '-q', '-b', 'main')
  commit('base.txt', 'base')
  git('branch', 'base')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('fatias: dependências e ondas (puro)', () => {
  it('lê trailers, dependências e escolhe as prontas', () => {
    expect(slicesDone(['2', '1, 3', 'x', '#4'])).toEqual([1, 2, 3, 4])
    const deps = sliceDeps({ depende_3: '1,2', depende_2: '1', outra: '5' })
    expect(deps.get(3)).toEqual([1, 2])
    expect(nextSlices(4, [], deps)).toEqual([1, 4])
    expect(nextSlices(4, [1], deps, 1)).toEqual([2])
    expect(sliceWaves(4, deps)).toEqual([[1, 4], [2], [3]])
    expect(sliceWaves(4, deps, 1)).toEqual([[1], [2], [3], [4]])
    // Ciclo não trava: vale a de menor número.
    expect(
      nextSlices(
        2,
        [],
        new Map([
          [1, [2]],
          [2, [1]]
        ])
      )
    ).toEqual([1])
  })
})

describe('slices_checkpoint: o git manda', () => {
  it('retomada idempotente: fatias com trailer contam como feitas', async () => {
    const [action] = createSliceActions({
      worktree: () => ({ path: dir, baseRef: 'base' }),
      git: createGit()
    })
    const vars = { fatias: '3', depende_3: '2' }
    let r = await action!.run({ projectId: 'p', taskId: 't', vars })
    expect(r).toMatchObject({
      ok: true,
      vars: { 'fatias.feitas': 'nenhuma', 'fatias.proximas': '1, 2', restam: '3' }
    })
    commit('a.txt', 'feat: fatia 2\n\nSpec-Slice: 2')
    commit('b.txt', 'wip sem trailer')
    r = await action!.run({ projectId: 'p', taskId: 't', vars })
    expect(r).toMatchObject({
      vars: { 'fatias.feitas': '2', 'fatias.proximas': '1, 3', restam: '2' }
    })
    commit('c.txt', 'feat: fatias 1 e 3\n\nSpec-Slice: 1\nSpec-Slice: 3')
    r = await action!.run({ projectId: 'p', taskId: 't', vars })
    expect(r).toMatchObject({ vars: { 'fatias.feitas': '1, 2, 3', restam: '0' } })
  })
})

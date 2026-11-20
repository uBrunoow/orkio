import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardStore } from '../board/board.store'
import { openDatabase, type Db } from '../db/database'
import { createGit } from '../git/git'
import { ARTIFACT_MESSAGES, ArtifactsService } from './artifacts.service'

let dir: string
let db: Db
let base: string
const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir }).toString().trim()

function setup() {
  const store = new BoardStore(db)
  const notion = {
    createChildPage: vi.fn(async () => ({ id: 'page-new', url: 'https://www.notion.so/page-new' })),
    appendMarkdown: vi.fn(async () => undefined)
  }
  const service = new ArtifactsService({
    db,
    store,
    worktrees: {
      get: () => ({
        taskPageId: 't1',
        projectId: 'p1',
        path: dir,
        branch: 'ORK-1/x',
        baseRef: base,
        createdAt: 'x'
      })
    },
    git: createGit(),
    notion
  })
  return { service, notion, store }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orkio-art-'))
  db = openDatabase(':memory:')
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e@x.com')
  git('config', 'user.name', 'E')
  await writeFile(join(dir, 'README.md'), '# r\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  base = git('rev-parse', 'HEAD')
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('ArtifactsService', () => {
  it('lista só documentos alterados; não commitado não pode ser anexado', async () => {
    const { service } = setup()
    await mkdir(join(dir, 'docs'))
    await writeFile(join(dir, 'docs', 'spec.md'), '# Spec\n')
    await writeFile(join(dir, 'app.ts'), 'x')
    expect(await service.candidates('t1')).toEqual([{ path: 'docs/spec.md', committed: false }])
    await expect(service.attach('p1', 't1', 'docs/spec.md', null)).rejects.toThrow(
      ARTIFACT_MESSAGES.uncommitted
    )
    await expect(service.attach('p1', 't1', 'app.ts', null)).rejects.toThrow(
      ARTIFACT_MESSAGES.notCandidate
    )
  })

  it('anexa caminho + commit (idempotente) e publica a versão do commit', async () => {
    const { service, notion, store } = setup()
    await mkdir(join(dir, 'docs'))
    await writeFile(
      join(dir, 'docs', 'spec.md'),
      '# Exportar CSV\n\n## Passos\n\nUse API_KEY=abc123segredo\n'
    )
    git('add', '.')
    git('commit', '-q', '-m', 'doc')
    const head = git('rev-parse', 'HEAD')
    const a = await service.attach('p1', 't1', 'docs/spec.md', 'run-1')
    expect(a).toMatchObject({ path: 'docs/spec.md', commit: head, runId: 'run-1', notion: null })
    expect((await service.attach('p1', 't1', 'docs/spec.md', null)).id).toBe(a.id)

    // Rascunho depois do anexo não entra na publicação.
    await writeFile(join(dir, 'docs', 'spec.md'), '# RASCUNHO\n')

    await service.publish(a.id, 'section', dir)
    const [pageId, section] = notion.appendMarkdown.mock.calls[0] as unknown as [string, string]
    expect(pageId).toBe('t1')
    expect(section).toContain('## spec.md')
    expect(section).toContain('### Passos') // títulos descem um nível
    expect(section).toContain(head.slice(0, 7))
    expect(section).not.toContain('RASCUNHO')
    expect(section).not.toContain('abc123segredo')

    const { artifact, url } = await service.publish(a.id, 'child_page', dir)
    expect(notion.createChildPage).toHaveBeenCalledWith('t1', 'Exportar CSV', expect.any(String))
    expect(url).toBe('https://www.notion.so/page-new')
    expect(artifact.notion).toMatchObject({ mode: 'child_page', pageId: 'page-new' })
    expect(store.events('t1').map((e) => e.kind)).toEqual([
      'artifact_published',
      'artifact_published',
      'artifact_attached'
    ])
  })

  it('documento grande demais é recusado antes de chamar o Notion', async () => {
    const { service, notion } = setup()
    await writeFile(join(dir, 'grande.md'), 'x'.repeat(160_000))
    git('add', '.')
    git('commit', '-q', '-m', 'g')
    const a = await service.attach('p1', 't1', 'grande.md', null)
    await expect(service.publish(a.id, 'child_page', dir)).rejects.toThrow(ARTIFACT_MESSAGES.tooBig)
    expect(notion.createChildPage).not.toHaveBeenCalled()
  })
})

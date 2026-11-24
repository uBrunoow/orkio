import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoredProject } from '../config/orkio-config'
import { createGit } from '../git/git'
import type { WorktreeRecord } from '../claude/worktree.service'
import { isAllowedExternalUrl } from '../ipc/shell.ipc'
import { DeliveryError, DeliveryService, parseGhAliases } from './delivery.service'

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@x',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@x',
      GIT_TERMINAL_PROMPT: '0'
    }
  })
}

const BRANCH = 'ORK-7/exportar-csv'

describe('DeliveryService com git real', () => {
  let tmp: string
  let bare: string
  let wtPath: string
  let project: StoredProject
  let record: WorktreeRecord
  let service: DeliveryService

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'orkio-delivery-')))
  })
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  beforeEach(async () => {
    const run = join(tmp, String(Math.random()).slice(2))
    await mkdir(run)
    bare = join(run, 'remote.git')
    sh(run, 'init', '-q', '--bare', '-b', 'main', bare)
    const seed = join(run, 'seed')
    sh(run, 'clone', '-q', bare, seed)
    await writeFile(join(seed, 'README.md'), 'oi\n')
    sh(seed, 'add', '.')
    sh(seed, 'commit', '-q', '-m', 'inicial')
    sh(seed, 'push', '-q', 'origin', 'HEAD:main')
    const main = join(run, 'projeto')
    sh(run, 'clone', '-q', bare, main)
    wtPath = join(run, 'worktrees', 'ORK-7')
    sh(main, 'worktree', 'add', '-q', '-b', BRANCH, wtPath, 'origin/main')
    project = {
      id: 'p1',
      name: 'app',
      localPath: main,
      createdAt: '',
      updatedAt: '',
      notionProject: null,
      repo: {
        host: 'github.com',
        owner: 'acme',
        name: 'app',
        remoteName: 'origin',
        defaultBranch: 'main',
        visibility: 'private',
        canPush: true,
        archived: false,
        verified: true
      }
    }
    record = {
      taskPageId: 't1',
      projectId: 'p1',
      path: wtPath,
      branch: BRANCH,
      baseRef: 'origin/main',
      createdAt: ''
    }
    service = new DeliveryService({
      git: createGit(),
      project: (id) => (id === 'p1' ? project : null),
      worktree: (id) => (id === 't1' ? record : null),
      settings: () => undefined
    })
  })

  async function commit(file: string, msg: string): Promise<void> {
    await writeFile(join(wtPath, file), `${msg}\n`)
    sh(wtPath, 'add', file)
    sh(wtPath, 'commit', '-q', '-m', msg)
  }

  it('prévia mostra commits, stat e destino; push envia a branch da tarefa (sem força)', async () => {
    await commit('a.txt', 'feat: a')
    await commit('b.txt', 'feat: b')
    const p = await service.preview('p1', 't1')
    expect(p.problem).toBeNull()
    expect(p.remoteExists).toBe(false)
    expect(p.commits.map((c) => c.subject)).toEqual(['feat: b', 'feat: a'])
    expect(p.stat).toMatch(/2 files changed/)
    expect(p.target).toMatchObject({ remote: 'origin', branch: BRANCH, displayId: 'ORK-7' })
    expect(p.branchUrl).toBe(`https://github.com/acme/app/tree/ORK-7/exportar-csv`)

    const r = await service.push('p1', 't1')
    expect(r.commits).toBe(2)
    expect(sh(bare, 'rev-parse', BRANCH).trim()).toBe(sh(wtPath, 'rev-parse', 'HEAD').trim())
    // Upstream configurado (-u).
    expect(sh(wtPath, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe(`origin/${BRANCH}`)
    // Segunda vez: nada novo.
    await expect(service.push('p1', 't1')).rejects.toMatchObject({ code: 'nothing' })
    await commit('c.txt', 'feat: c')
    const p2 = await service.preview('p1', 't1')
    expect(p2.remoteExists).toBe(true)
    expect(p2.commits.map((c) => c.subject)).toEqual(['feat: c'])
  })

  it('compareUrl: base...branch por segmento; sem branch padrão, só a branch', async () => {
    expect(service.compareUrl('p1', 't1')).toBe(
      'https://github.com/acme/app/compare/main...ORK-7/exportar-csv?expand=1'
    )
    record = { ...record, branch: "feat/a b!x'(y)*~z" }
    const url = service.compareUrl('p1', 't1')
    expect(url).toBe(
      'https://github.com/acme/app/compare/main...feat/a%20b%21x%27%28y%29%2A%7Ez?expand=1'
    )
    // Codificação e allowlist do shell concordam.
    expect(isAllowedExternalUrl(url)).toBe(true)
    project = { ...project, repo: { ...project.repo!, defaultBranch: null } }
    expect(service.compareUrl('p1', 't1')).toBe(
      'https://github.com/acme/app/compare/feat/a%20b%21x%27%28y%29%2A%7Ez?expand=1'
    )
  })

  it('alreadyPushed: só com a branch remota igual ao HEAD', async () => {
    expect(await service.alreadyPushed('p1', 't1')).toBe(false) // nunca enviada
    await commit('a.txt', 'feat: a')
    expect(await service.alreadyPushed('p1', 't1')).toBe(false) // à frente
    await service.push('p1', 't1')
    expect(await service.alreadyPushed('p1', 't1')).toBe(true)
  })

  it('sem commits novos → recusa', async () => {
    await expect(service.push('p1', 't1')).rejects.toMatchObject({
      code: 'nothing',
      message: expect.stringContaining('Não há commits')
    })
  })

  it('mudanças não commitadas → recusa sem enviar', async () => {
    await commit('a.txt', 'feat: a')
    await writeFile(join(wtPath, 'sujo.txt'), 'x')
    await expect(service.push('p1', 't1')).rejects.toMatchObject({ code: 'dirty' })
    expect(() => sh(bare, 'rev-parse', '--verify', '--quiet', BRANCH)).toThrow()
  })

  it('branch errada no worktree (trocaram para outra) → recusa', async () => {
    sh(wtPath, 'checkout', '-q', '-b', 'ORK-8/outra')
    await commit('a.txt', 'feat: a')
    await expect(service.push('p1', 't1')).rejects.toMatchObject({ code: 'branch' })
  })

  it('branch da tarefa protegida (main) → recusa', async () => {
    record = { ...record, branch: 'main' }
    await expect(service.push('p1', 't1')).rejects.toMatchObject({
      code: 'branch',
      message: expect.stringContaining('protegida')
    })
  })

  it('remota divergiu: o GitHub recusa e o Orkio NÃO força', async () => {
    await commit('a.txt', 'feat: a')
    await service.push('p1', 't1')
    // Alguém reescreveu a branch remota.
    const other = join(tmp, `other-${Math.random()}`)
    sh(tmp, 'clone', '-q', '-b', BRANCH, bare, other)
    sh(other, 'commit', '-q', '--amend', '-m', 'reescrito')
    sh(other, 'push', '-q', '--force', 'origin', BRANCH)
    const remoteSha = sh(bare, 'rev-parse', BRANCH).trim()
    sh(wtPath, 'reset', '-q', '--hard', 'HEAD') // nada pendente
    await commit('b.txt', 'feat: b')
    // A prévia busca a remota; o push é recusado (non-fast-forward) e a remota fica intacta.
    await expect(service.push('p1', 't1')).rejects.toBeInstanceOf(DeliveryError)
    expect(sh(bare, 'rev-parse', BRANCH).trim()).toBe(remoteSha)
  })

  it('sem repositório verificado ou sem ambiente → erro claro', async () => {
    project = { ...project, repo: { ...project.repo!, verified: false } }
    expect(() => service.target('p1', 't1')).toThrow(/repositório do GitHub verificado/)
    project = { ...project, repo: { ...project.repo!, verified: true } }
    expect(() => service.target('p1', 'x')).toThrow(/ainda não tem ambiente/)
  })

  describe('credenciais pedidas', () => {
    let server: Server
    let url: string
    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' })
        res.end()
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/acme/app.git`
    })
    afterAll(() => new Promise<void>((r) => server.close(() => r())))

    it('o git pede usuário/senha → falha na hora com mensagem de credenciais (sem travar)', async () => {
      await commit('a.txt', 'feat: a')
      sh(wtPath, 'remote', 'set-url', 'origin', url)
      // Sem credential helper do sistema neste teste.
      sh(wtPath, 'config', 'credential.helper', '')
      const started = Date.now()
      const err = await service.push('p1', 't1').catch((e: unknown) => e)
      expect(err).toMatchObject({
        code: 'credentials',
        message: expect.stringContaining('credenciais')
      })
      expect(String((err as Error).message)).not.toContain('127.0.0.1')
      expect(Date.now() - started).toBeLessThan(20_000)
    })
  })
})

describe('parseGhAliases', () => {
  it('lê a saída do gh alias list (com aspas)', () => {
    expect(
      parseGhAliases(
        'co: pr checkout\nm: \'pr merge --squash\'\nbugs: "!gh issue list --label=bug"\n\n'
      )
    ).toEqual({ co: 'pr checkout', m: 'pr merge --squash', bugs: '!gh issue list --label=bug' })
  })
})

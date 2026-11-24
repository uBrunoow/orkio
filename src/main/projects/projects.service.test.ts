import { ORKIO_CONFIG_VERSION } from '../config/orkio-config'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrkioConfigStore } from '../config/orkio-config'
import { GitHubApiError, type GitHubRepo } from '../connectors/github/github.client'
import { GitError, type Git, type GitRemote } from '../git/git'
import {
  ProjectsService,
  type HeadWatcherLike,
  type ProjectsGitHub,
  type ProjectsServiceDeps
} from './projects.service'
import type { BranchChangedEvent, PickFolderResult, ProjectSelection } from '../../shared/projects'

interface FakeRepo {
  remotes: GitRemote[]
  branch: string | null
  dirty: boolean
}

/** Git simulado: repositórios por raiz; subpastas resolvem para a raiz. */
function fakeGit(
  repos: Record<string, FakeRepo>,
  opts: { gitMissing?: boolean } = {}
): ProjectsServiceDeps['git'] & Pick<Git, 'localBranches'> {
  const rootOf = (dir: string): string => {
    if (opts.gitMissing) {
      throw new GitError(
        'git_not_found',
        'O git não foi encontrado no PATH. Instale o git e reinicie o Orkio.'
      )
    }
    const root = Object.keys(repos)
      .sort((a, b) => b.length - a.length)
      .find((r) => dir === r || dir.startsWith(`${r}/`))
    if (!root) throw new GitError('not_a_repo', 'Esta pasta não é um repositório git.')
    return root
  }
  const repo = (dir: string): FakeRepo => repos[rootOf(dir)]!
  return {
    showToplevel: vi.fn(async (dir: string) => rootOf(dir)),
    absoluteGitDir: vi.fn(async (root: string) => `${rootOf(root)}/.git`),
    remotes: vi.fn(async (root: string) => repo(root).remotes),
    currentBranch: vi.fn(async (root: string) => repo(root).branch),
    isDirty: vi.fn(async (root: string) => repo(root).dirty),
    remoteDefaultBranch: vi.fn(async () => 'main'),
    localBranches: vi.fn(async () => [])
  }
}

const ORKIO_REPO: GitHubRepo = {
  owner: 'uBrunoow',
  name: 'orkio',
  defaultBranch: 'main',
  visibility: 'private',
  archived: false,
  canPush: true
}

describe('ProjectsService', () => {
  let dir: string
  let configFile: string
  let repos: Record<string, FakeRepo>
  let existing: Set<string>
  let picks: (string | null)[]
  let github: { [K in keyof ProjectsGitHub]: ReturnType<typeof vi.fn<ProjectsGitHub[K]>> }
  let events: BranchChangedEvent[]
  let watchers: {
    gitDir: string
    onBranchChange(b: string | null): void
    stop: ReturnType<typeof vi.fn>
  }[]
  let ids: number

  function makeService(overrides: { git?: ProjectsServiceDeps['git'] } = {}): ProjectsService {
    return new ProjectsService({
      store: createOrkioConfigStore(configFile),
      git: overrides.git ?? fakeGit(repos),
      github,
      pickFolder: vi.fn(async () => picks.shift() ?? null),
      folderExists: async (path) => existing.has(path),
      realpath: async (path) => path,
      onBranchChanged: (e) => events.push(e),
      createHeadWatcher: (gitDir, handlers) => {
        const entry = { gitDir, onBranchChange: handlers.onBranchChange, stop: vi.fn() }
        watchers.push(entry)
        return { start: async () => null, stop: entry.stop } satisfies HeadWatcherLike
      },
      now: () => new Date('2026-11-19T12:00:00.000Z'),
      newId: () => `id-${++ids}`
    })
  }

  async function select(service: ProjectsService, folder: string): Promise<ProjectSelection> {
    picks.push(folder)
    const result = await service.pickFolder()
    if (!result.ok) throw new Error(`esperava seleção, veio ${JSON.stringify(result)}`)
    return result.selection
  }

  async function errorOf(result: Promise<PickFolderResult | { ok: boolean }>): Promise<unknown> {
    const r = (await result) as { ok: boolean; error?: unknown }
    expect(r.ok).toBe(false)
    return r.error
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-projects-'))
    configFile = join(dir, 'orkio-config.json')
    repos = {
      '/code/orkio': {
        remotes: [
          { name: 'upstream', url: 'https://github.com/acme/orkio.git' },
          { name: 'origin', url: 'git@github.com:ubrunoow/orkio.git' }
        ],
        branch: 'main',
        dirty: true
      }
    }
    existing = new Set(['/code/orkio'])
    picks = []
    github = {
      isConnected: vi.fn(async () => true),
      getRepository: vi.fn(async () => ORKIO_REPO),
      accessSettingsUrl: vi.fn(
        async () => 'https://github.com/settings/connections/applications/Iv1.abc'
      )
    }
    events = []
    watchers = []
    ids = 0
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('adicionar projeto', () => {
    it('subpasta → usa a raiz, avisa, e cria com owner/repo do GitHub', async () => {
      const service = makeService()
      await service.init()

      const selection = await select(service, '/code/orkio/src/main')
      expect(selection).toMatchObject({
        rootPath: '/code/orkio',
        folderName: 'orkio',
        resolvedFromSubfolder: true,
        branch: 'main',
        dirty: true,
        suggestedRemote: 'origin'
      })
      // origin primeiro, upstream (fork) depois.
      expect(selection.candidates.map((c) => `${c.remoteName}:${c.owner}/${c.name}`)).toEqual([
        'origin:ubrunoow/orkio',
        'upstream:acme/orkio'
      ])

      const result = await service.create({
        selectionId: selection.selectionId,
        remoteName: 'origin',
        hostConfirmed: false
      })
      expect(result).toMatchObject({
        ok: true,
        project: {
          name: 'orkio',
          localPath: '/code/orkio',
          repo: {
            host: 'github.com',
            owner: 'uBrunoow', // grafia canônica do GitHub
            name: 'orkio',
            remoteName: 'origin',
            defaultBranch: 'main',
            visibility: 'private',
            canPush: true,
            archived: false,
            verified: true
          },
          local: { branch: 'main', dirty: true },
          health: { state: 'ok' },
          notices: []
        }
      })
      expect(github.getRepository).toHaveBeenCalledWith('ubrunoow', 'orkio')

      // Persistido no ConfigStore (JSON, sem segredos).
      const saved = JSON.parse(await readFile(configFile, 'utf8'))
      expect(saved.schemaVersion).toBe(ORKIO_CONFIG_VERSION)
      expect(saved.projects).toHaveLength(1)
      expect(JSON.stringify(saved)).not.toMatch(/token|gho_|github_pat/i)
    })

    it('fork: escolher o upstream cria o projeto apontando para ele', async () => {
      github.getRepository.mockResolvedValueOnce({ ...ORKIO_REPO, owner: 'acme', canPush: false })
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      const result = await service.create({
        selectionId: selection.selectionId,
        remoteName: 'upstream',
        hostConfirmed: false,
        name: 'Orkio (upstream)'
      })
      expect(result).toMatchObject({
        ok: true,
        project: {
          name: 'Orkio (upstream)',
          repo: { owner: 'acme', remoteName: 'upstream', canPush: false },
          notices: [{ code: 'no_push' }]
        }
      })
    })

    it('cancelar o seletor de pasta → cancelled', async () => {
      const service = makeService()
      await service.init()
      expect(await service.pickFolder()).toEqual({ ok: false, cancelled: true })
    })

    it('pasta que não é repositório git', async () => {
      existing.add('/tmp/solta')
      const service = makeService()
      await service.init()
      picks.push('/tmp/solta')
      expect(await errorOf(service.pickFolder())).toEqual({
        code: 'not_a_repo',
        message: 'Esta pasta não é um repositório git.'
      })
    })

    it('git não encontrado no PATH', async () => {
      const service = makeService({ git: fakeGit(repos, { gitMissing: true }) })
      await service.init()
      picks.push('/code/orkio')
      expect(await errorOf(service.pickFolder())).toMatchObject({
        code: 'git_not_found',
        message: expect.stringContaining('PATH')
      })
    })

    it('repositório sem remote', async () => {
      repos['/code/local'] = { remotes: [], branch: 'main', dirty: false }
      const service = makeService()
      await service.init()
      picks.push('/code/local')
      expect(await errorOf(service.pickFolder())).toMatchObject({
        code: 'no_remote',
        message: expect.stringContaining('não tem remote')
      })
    })

    it('remote que não é GitHub (ex.: GitLab via caminho, Bitbucket via git://)', async () => {
      repos['/code/gl'] = {
        remotes: [{ name: 'origin', url: 'git://gitlab.example.org/team/app.git' }],
        branch: 'main',
        dirty: false
      }
      const service = makeService()
      await service.init()
      picks.push('/code/gl')
      expect(await errorOf(service.pickFolder())).toMatchObject({
        code: 'not_github',
        message: expect.stringContaining('gitlab.example.org')
      })
    })

    it('GitHub não conectado', async () => {
      github.isConnected.mockResolvedValue(false)
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      expect(
        await errorOf(
          service.create({
            selectionId: selection.selectionId,
            remoteName: 'origin',
            hostConfirmed: false
          })
        )
      ).toMatchObject({
        code: 'github_disconnected',
        message: expect.stringContaining('Integrações')
      })
    })

    it('sem acesso ao repositório (404)', async () => {
      github.getRepository.mockRejectedValueOnce(
        new GitHubApiError(
          'not_found',
          'O GitHub não encontrou este repositório com a conta conectada.'
        )
      )
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      expect(
        await errorOf(
          service.create({
            selectionId: selection.selectionId,
            remoteName: 'origin',
            hostConfirmed: false
          })
        )
      ).toMatchObject({ code: 'no_access' })
      await expect(service.list()).resolves.toMatchObject({ projects: [] })
    })

    it('org com SSO → mensagem + link de autorização do próprio GitHub', async () => {
      github.getRepository.mockRejectedValueOnce(
        new GitHubApiError('sso_required', 'A organização acme usa SSO (SAML).', 403, {
          org: 'acme',
          ssoUrl: 'https://github.com/orgs/acme/sso?authorization_request=X'
        })
      )
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      expect(
        await errorOf(
          service.create({
            selectionId: selection.selectionId,
            remoteName: 'origin',
            hostConfirmed: false
          })
        )
      ).toEqual({
        code: 'sso_required',
        message: 'A organização acme usa SSO (SAML).',
        action: {
          label: 'Autorizar SSO da organização',
          url: 'https://github.com/orgs/acme/sso?authorization_request=X'
        }
      })
    })

    it('org com restrição de OAuth Apps → admin precisa aprovar + link das configurações de acesso', async () => {
      github.getRepository.mockRejectedValueOnce(
        new GitHubApiError(
          'oauth_restricted',
          'A organização acme restringe o acesso de OAuth Apps. Um admin da organização precisa aprovar o Orkio.',
          403
        )
      )
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      expect(
        await errorOf(
          service.create({
            selectionId: selection.selectionId,
            remoteName: 'origin',
            hostConfirmed: false
          })
        )
      ).toEqual({
        code: 'oauth_restricted',
        message: expect.stringContaining('admin da organização precisa aprovar'),
        action: {
          label: 'Abrir configurações de acesso do GitHub',
          url: 'https://github.com/settings/connections/applications/Iv1.abc'
        }
      })
    })

    it('repo arquivado → salva, mas avisa', async () => {
      github.getRepository.mockResolvedValueOnce({ ...ORKIO_REPO, archived: true })
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      const result = await service.create({
        selectionId: selection.selectionId,
        remoteName: 'origin',
        hostConfirmed: false
      })
      expect(result).toMatchObject({ ok: true, project: { notices: [{ code: 'archived' }] } })
    })

    it('alias de SSH: exige confirmação; confirmado, valida em github.com', async () => {
      repos['/code/work'] = {
        remotes: [{ name: 'origin', url: 'git@github-trabalho:acme/api.git' }],
        branch: 'dev',
        dirty: false
      }
      existing.add('/code/work')
      github.getRepository.mockResolvedValueOnce({ ...ORKIO_REPO, owner: 'acme', name: 'api' })
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/work')
      expect(selection.candidates[0]).toMatchObject({
        host: 'github-trabalho',
        hostKind: 'ssh-alias'
      })

      expect(
        await errorOf(
          service.create({
            selectionId: selection.selectionId,
            remoteName: 'origin',
            hostConfirmed: false
          })
        )
      ).toMatchObject({
        code: 'host_unconfirmed',
        message: expect.stringContaining('github-trabalho')
      })

      const ok = await service.create({
        selectionId: selection.selectionId,
        remoteName: 'origin',
        hostConfirmed: true
      })
      expect(ok).toMatchObject({
        ok: true,
        project: { repo: { host: 'github.com', owner: 'acme', name: 'api', verified: true } }
      })
    })

    it('GitHub Enterprise confirmado → salvo "não verificado", sem chamar a API', async () => {
      repos['/code/ghe'] = {
        remotes: [{ name: 'origin', url: 'https://github.acme.com/team/app.git' }],
        branch: 'main',
        dirty: false
      }
      existing.add('/code/ghe')
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/ghe')
      const result = await service.create({
        selectionId: selection.selectionId,
        remoteName: 'origin',
        hostConfirmed: true
      })
      expect(result).toMatchObject({
        ok: true,
        project: {
          repo: {
            host: 'github.acme.com',
            owner: 'team',
            verified: false,
            visibility: 'unknown',
            canPush: null
          },
          notices: [{ code: 'enterprise_unverified' }]
        }
      })
      expect(github.getRepository).not.toHaveBeenCalled()
    })

    it('mesma pasta duas vezes → already_added', async () => {
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      await service.create({
        selectionId: selection.selectionId,
        remoteName: 'origin',
        hostConfirmed: false
      })
      picks.push('/code/orkio/src')
      expect(await errorOf(service.pickFolder())).toMatchObject({ code: 'already_added' })
    })

    it('seleção expirada ou inventada pelo renderer → selection_expired', async () => {
      const service = makeService()
      await service.init()
      expect(
        await errorOf(
          service.create({ selectionId: 'id-falso', remoteName: 'origin', hostConfirmed: false })
        )
      ).toMatchObject({ code: 'selection_expired' })
    })
  })

  describe('saúde, reapontar e remover', () => {
    async function withProject(): Promise<{ service: ProjectsService; id: string }> {
      const service = makeService()
      await service.init()
      const selection = await select(service, '/code/orkio')
      const result = await service.create({
        selectionId: selection.selectionId,
        remoteName: 'origin',
        hostConfirmed: false
      })
      if (!result.ok) throw new Error('falhou ao criar')
      return { service, id: result.project.id }
    }

    it('reabrir o app: lista do disco com branch/sujeira e revalida no GitHub', async () => {
      await withProject()
      const reopened = makeService()
      await reopened.init()

      const quick = await reopened.list()
      expect(quick.projects[0]).toMatchObject({
        local: { branch: 'main', dirty: true },
        health: { state: 'checking' }
      })

      github.getRepository.mockResolvedValueOnce({ ...ORKIO_REPO, defaultBranch: 'develop' })
      const full = await reopened.revalidate()
      expect(full.projects[0]).toMatchObject({
        health: { state: 'ok' },
        repo: { defaultBranch: 'develop' }
      })
      // A mudança no GitHub foi salva.
      expect(JSON.parse(await readFile(configFile, 'utf8')).projects[0].repo.defaultBranch).toBe(
        'develop'
      )
    })

    it('pasta sumiu → missing_folder e watcher parado', async () => {
      const { service } = await withProject()
      await service.list()
      expect(watchers).toHaveLength(1)
      existing.delete('/code/orkio')

      const result = await service.list()
      expect(result.projects[0]).toMatchObject({
        local: null,
        health: {
          state: 'missing_folder',
          message: expect.stringContaining('Pasta não encontrada')
        }
      })
      expect(watchers[0]!.stop).toHaveBeenCalled()
    })

    it('pasta agora é de outro repositório → repo_mismatch', async () => {
      const { service } = await withProject()
      repos['/code/orkio']!.remotes = [
        { name: 'origin', url: 'https://github.com/other/thing.git' }
      ]
      expect((await service.list()).projects[0]!.health).toMatchObject({
        state: 'repo_mismatch',
        message: expect.stringContaining('other/thing')
      })
    })

    it('GitHub desconectado / rede fora / sem acesso na revalidação', async () => {
      const { service } = await withProject()

      github.isConnected.mockResolvedValueOnce(false)
      expect((await service.revalidate()).projects[0]!.health.state).toBe('github_disconnected')

      github.getRepository.mockRejectedValueOnce(new GitHubApiError('network', 'Sem internet.'))
      expect((await service.revalidate()).projects[0]!.health).toMatchObject({
        state: 'unverified',
        message: expect.stringContaining('Sem internet.')
      })

      github.getRepository.mockRejectedValueOnce(new GitHubApiError('not_found', 'Sem acesso.'))
      expect((await service.revalidate()).projects[0]!.health).toMatchObject({
        state: 'no_access',
        message: 'Sem acesso.'
      })
    })

    it('reapontar: pasta de outro repositório é recusada; do mesmo repo é aceita', async () => {
      const { service, id } = await withProject()
      existing.delete('/code/orkio')
      repos['/novo/lugar/orkio'] = {
        remotes: [{ name: 'origin', url: 'https://github.com/uBrunoow/Orkio' }],
        branch: 'feature',
        dirty: false
      }
      repos['/outro'] = {
        remotes: [{ name: 'origin', url: 'https://github.com/x/y' }],
        branch: 'main',
        dirty: false
      }
      existing.add('/novo/lugar/orkio')

      picks.push('/outro')
      expect(await errorOf(service.relocate(id))).toMatchObject({
        code: 'repo_mismatch',
        message: expect.stringContaining('x/y')
      })

      picks.push('/novo/lugar/orkio')
      const moved = await service.relocate(id)
      expect(moved).toMatchObject({
        ok: true,
        project: {
          localPath: '/novo/lugar/orkio',
          local: { branch: 'feature' },
          health: { state: 'ok' }
        }
      })
    })

    it('remover só tira do Orkio', async () => {
      const { service, id } = await withProject()
      await service.list()
      expect(await service.remove(id)).toEqual({ ok: true })
      expect((await service.list()).projects).toEqual([])
      expect(existing.has('/code/orkio')).toBe(true)
      expect(watchers[0]!.stop).toHaveBeenCalled()
      expect(await service.remove(id)).toEqual({ ok: false })
    })

    it('mudança de branch vira evento com o id do projeto', async () => {
      const { service, id } = await withProject()
      await service.list()
      expect(watchers[0]!.gitDir).toBe('/code/orkio/.git')
      watchers[0]!.onBranchChange('ORK-142/sync')
      expect(events).toEqual([{ projectId: id, branch: 'ORK-142/sync' }])
    })

    it('config corrompida: aviso aparece na lista', async () => {
      await import('node:fs/promises').then((fs) => fs.writeFile(configFile, '{oops'))
      const service = makeService()
      await service.init()
      const result = await service.list()
      expect(result.projects).toEqual([])
      expect(result.warning).toMatch(/corrompidas/)
    })
  })
})

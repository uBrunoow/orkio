import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrkioConfigStore, type OrkioConfig } from '../config/orkio-config'
import { type ConditionalPage } from '../connectors/github/github.client'
import { GitError } from '../git/git'
import type { ConfigStore } from '../storage/config-store'
import { SIGNALS_MESSAGES, TaskSignalsService, type SignalsGitHub } from './task-signals.service'
import type { NotionTask } from '../../shared/notion'
import { ApiError } from '../net/http'

const NOW = new Date('2026-11-19T12:00:00Z')

const task = (id: string, displayId: string | null): NotionTask => ({
  id,
  url: null,
  displayId,
  title: id,
  status: null,
  priority: null,
  assignees: []
})
const TASKS = [task('t142', 'ORK-142'), task('t14', 'ORK-14'), task('t7', '7')]

const repo = (over: Record<string, unknown> = {}) => ({
  host: 'github.com',
  owner: 'acme',
  name: 'app',
  remoteName: 'origin',
  defaultBranch: 'main',
  visibility: 'private',
  canPush: true,
  archived: false,
  verified: true,
  ...over
})

describe('TaskSignalsService', () => {
  let dir: string
  let store: ConfigStore<OrkioConfig>
  let github: { [K in keyof SignalsGitHub]: ReturnType<typeof vi.fn<SignalsGitHub[K]>> }
  let localBranches: ReturnType<typeof vi.fn<(root: string) => Promise<string[]>>>
  let pages: Record<string, unknown[]>

  async function service(projectRepo: unknown = repo()): Promise<TaskSignalsService> {
    await writeFile(
      join(dir, 'c.json'),
      JSON.stringify({
        schemaVersion: 2,
        notion: null,
        projects: [
          {
            id: 'p1',
            name: 'app',
            localPath: '/code/app',
            repo: projectRepo,
            createdAt: 'x',
            updatedAt: 'x',
            notionProject: { id: 'n1', name: 'App' }
          }
        ]
      })
    )
    store = createOrkioConfigStore(join(dir, 'c.json'))
    await store.load()
    return new TaskSignalsService({
      store,
      git: { localBranches },
      github,
      listTasks: async () => ({
        ok: true,
        value: { tasks: TASKS, truncated: false, fetchedAt: NOW.toISOString(), fromCache: true }
      }),
      now: () => NOW
    })
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orkio-signals-'))
    pages = {
      '/repos/acme/app/branches?per_page=100': [{ name: 'main' }, { name: 'feat/ORK-142-sync' }],
      '/repos/acme/app/pulls?state=open&per_page=100': [
        {
          number: 12,
          title: 'ORK-142 sincronizar',
          html_url: 'https://github.com/acme/app/pull/12',
          state: 'open',
          draft: false,
          merged_at: null,
          updated_at: '2026-11-18T00:00:00Z',
          head: { ref: 'feat/ORK-142-sync' }
        }
      ]
    }
    localBranches = vi.fn(async () => ['main', 'ORK-14/login'])
    github = {
      isConnected: vi.fn(async () => true),
      accessSettingsUrl: vi.fn(
        async () => 'https://github.com/settings/connections/applications/abc'
      ),
      getConditional: vi.fn(async (path: string): Promise<ConditionalPage> => ({
        notModified: false,
        body: pages[path] ?? [],
        etag: null,
        nextPath: null
      })),
      graphql: vi.fn(async () => ({
        data: {
          repository: {
            pr12: {
              reviewDecision: 'CHANGES_REQUESTED',
              reviewThreads: { nodes: [{ isResolved: false }] },
              commits: { nodes: [] }
            }
          }
        },
        errors: []
      }))
    }
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('junta git local, branches remotas e PR com detalhes, sem confundir ORK-14 e ORK-142', async () => {
    const result = await (await service()).get('p1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { signals, github: state, tasksWithoutPrefix } = result.value
    expect(state).toBe('ok')
    expect(tasksWithoutPrefix).toBe(1)
    expect(signals['t142']).toMatchObject({
      localBranches: [],
      remoteBranches: ['feat/ORK-142-sync'],
      pr: { number: 12, state: 'open', reviewDecision: 'changes_requested', unresolvedComments: 1 }
    })
    expect(signals['t14']).toMatchObject({
      localBranches: ['ORK-14/login'],
      remoteBranches: [],
      pr: null
    })
    expect(signals['t7']).toBeUndefined()
    // GraphQL só para a PR que casa com tarefa.
    expect(github.graphql).toHaveBeenCalledTimes(1)
    expect(github.graphql.mock.calls[0]![0]).toContain('pr12:')
  })

  it('GitHub desconectado → só local, com aviso', async () => {
    github.isConnected.mockResolvedValue(false)
    const result = await (await service()).get('p1')
    expect(result).toMatchObject({
      ok: true,
      value: { github: 'disconnected', messages: [SIGNALS_MESSAGES.disconnected] }
    })
    if (result.ok) expect(result.value.signals['t14']?.localBranches).toEqual(['ORK-14/login'])
    expect(github.getConditional).not.toHaveBeenCalled()
  })

  it('sem acesso (404) e SSO → aviso, link e nada quebra', async () => {
    github.getConditional.mockRejectedValueOnce(
      new ApiError('github', 'not_found', 'Sem acesso.', 404)
    )
    expect(await (await service()).get('p1')).toMatchObject({
      ok: true,
      value: { github: 'no_access', messages: ['Sem acesso.'] }
    })
    github.getConditional.mockRejectedValueOnce(
      new ApiError('github', 'sso_required', 'SSO.', 403, {
        ssoUrl: 'https://github.com/orgs/acme/sso'
      })
    )
    expect(await (await service()).get('p1')).toMatchObject({
      value: { github: 'sso', action: { url: 'https://github.com/orgs/acme/sso' } }
    })
    github.getConditional.mockRejectedValueOnce(
      new ApiError('github', 'oauth_restricted', 'Restrito.', 403)
    )
    expect(await (await service()).get('p1')).toMatchObject({
      value: {
        github: 'restricted',
        action: { url: 'https://github.com/settings/connections/applications/abc' }
      }
    })
  })

  it('falha de rede depois de um sucesso → mantém o último resultado e avisa', async () => {
    const s = await service()
    await s.get('p1', { force: true })
    github.getConditional.mockRejectedValue(new ApiError('github', 'network', 'Sem conexão.'))
    const result = await s.get('p1', { force: true })
    expect(result).toMatchObject({
      ok: true,
      value: { github: 'unverified', messages: ['Sem conexão.', SIGNALS_MESSAGES.stale] }
    })
    if (result.ok) expect(result.value.signals['t142']?.pr?.number).toBe(12)
  })

  it('rate limit → estado próprio; sem force reaproveita o resultado recente', async () => {
    const s = await service()
    await s.get('p1')
    const calls = github.getConditional.mock.calls.length
    await s.get('p1')
    expect(github.getConditional.mock.calls.length).toBe(calls)
    github.getConditional.mockRejectedValueOnce(
      new ApiError('github', 'rate_limited', 'Limite.', 429)
    )
    expect(await s.get('p1', { force: true })).toMatchObject({ value: { github: 'rate_limited' } })
  })

  it('sem repositório, Enterprise e git local com erro', async () => {
    expect(await (await service(null)).get('p1')).toMatchObject({ value: { github: 'no_repo' } })
    expect(
      await (await service(repo({ host: 'ghe.acme.com', verified: false }))).get('p1')
    ).toMatchObject({ value: { github: 'enterprise' } })
    // Só git local: nada de API do Orkio, aviso próprio.
    github.getConditional.mockClear()
    const gitOnly = await (await service(repo({ verified: false, access: 'git' }))).get('p1')
    expect(gitOnly).toMatchObject({ value: { github: 'git_only' } })
    if (gitOnly.ok) expect(gitOnly.value.messages).toContain(SIGNALS_MESSAGES.gitOnly)
    expect(github.getConditional).not.toHaveBeenCalled()
    localBranches.mockRejectedValueOnce(new GitError('folder_not_found', 'x'))
    const result = await (await service()).get('p1')
    expect(result).toMatchObject({ value: { local: false, github: 'ok' } })
    if (result.ok) expect(result.value.messages).toContain(SIGNALS_MESSAGES.local)
  })

  it('erro das tarefas (ex.: projeto sem vínculo) é repassado; projeto inexistente', async () => {
    const s = await service()
    expect(await s.get('nope')).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })
})

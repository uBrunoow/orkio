/**
 * Sinais das tarefas de um projeto (Etapa 2D): branches locais (git), branches remotas e PRs
 * (GitHub) casadas pelo ID da tarefa. Só leitura. Base das automações da Etapa 3.
 *
 * Falhas não quebram: sem GitHub → só local, com aviso; sem acesso/SSO/rate limit/rede →
 * mantém o último resultado remoto conhecido (se houver) e explica.
 */
import { parseDisplayId } from '../../shared/task-id-match'
import {
  buildTaskSignals,
  type PullRequestDetails,
  type PullRequestSummary,
  type SignalsGitHubState,
  type TaskSignalsResult
} from '../../shared/task-signals'
import type { OrkioConfig } from '../config/orkio-config'
import type { Git } from '../git/git'
import type { ConfigStore } from '../storage/config-store'
import { GitHubRepoSignals, type GitHubSignalsApi } from './github-signals.source'
import type { Result } from '../../shared/result'
import type { NotionTasksResult } from '../../shared/notion'
import type { ProjectAction } from '../../shared/projects'
import { projectById } from '../config/queries'
import { gitRepoOf, githubRepoOf, readRepoOf, repoAccess } from '../../shared/projects'
import { isApiError } from '../net/http'

export interface SignalsGitHub extends GitHubSignalsApi {
  isConnected(): Promise<boolean>
  accessSettingsUrl(): Promise<string>
}

/** GitHub pelo `gh` do usuário (projeto só com git local): as mesmas leituras, e se está logado. */
export interface SignalsGh extends GitHubSignalsApi {
  status(): Promise<{ ok: true; login: string } | { ok: false; message: string }>
}

/** Projeto só com git local lê pelo `gh` a cada 5 min ("Atualizar" força na hora). */
export const GH_SIGNALS_INTERVAL_MS = 5 * 60_000

export interface TaskSignalsDeps {
  store: ConfigStore<OrkioConfig>
  git: Pick<Git, 'localBranches'>
  github: SignalsGitHub
  /** Leitura pelo `gh` dos projetos só com git local; ausente = esses projetos ficam só locais. */
  gh?: SignalsGh
  /** Tarefas do projeto (NotionWorkspaceService.listTasks, com o cache da 2C). */
  listTasks(projectId: string): Promise<Result<NotionTasksResult>>
  /** Branches registradas para cada tarefa do projeto (`task_branches`): ligam sem o ID no nome. */
  linkedBranches?: (projectId: string) => ReadonlyMap<string, readonly string[]>
  now?: () => Date
  /** Sem `force`, reaproveita o resultado remoto mais recente se tiver menos que isto. */
  minRemoteIntervalMs?: number
  /** O mesmo para a leitura pelo `gh` (padrão `GH_SIGNALS_INTERVAL_MS`). */
  ghIntervalMs?: number
}

export const SIGNALS_MESSAGES = {
  disconnected: 'Conecte o GitHub em Integrações para ver branches remotas e PRs.',
  noRepo: 'Este projeto não tem repositório do GitHub; só as branches locais aparecem.',
  enterprise:
    'Repositório do GitHub Enterprise: a conta conectada é do github.com, então só as branches locais aparecem.',
  gitOnly: 'Projeto só com git local: PRs e CI aparecem quando o Orkio puder ler pelo `gh`.',
  local: 'Não foi possível ler as branches locais (a pasta do projeto está acessível?).',
  stale: 'Mostrando o último resultado conhecido do GitHub.',
  unknown: 'Algo deu errado ao ler o GitHub. Tente novamente.',
  projectNotFound: 'Projeto não encontrado. Atualize a lista.'
} as const

interface RemoteState {
  repo: GitHubRepoSignals
  last: { branches: string[]; pulls: PullRequestSummary[]; at: number } | null
}

export class TaskSignalsService {
  private readonly now: () => Date
  private readonly remotes = new Map<string, RemoteState>()
  private readonly minInterval: number
  /** Último resultado de cada projeto (Visão geral, 6D: lida sem rede). */
  private readonly lastResults = new Map<string, TaskSignalsResult>()

  constructor(private readonly deps: TaskSignalsDeps) {
    this.now = deps.now ?? (() => new Date())
    this.minInterval = deps.minRemoteIntervalMs ?? 15_000
  }

  async get(
    projectId: string,
    options: { force?: boolean } = {}
  ): Promise<Result<TaskSignalsResult>> {
    const project = projectById(this.deps.store.get(), projectId)
    if (!project) {
      return { ok: false, error: { code: 'not_found', message: SIGNALS_MESSAGES.projectNotFound } }
    }
    const tasksResult = await this.deps.listTasks(projectId)
    if (!tasksResult.ok) return tasksResult
    const linked = this.deps.linkedBranches?.(projectId) ?? new Map<string, readonly string[]>()
    const tasks = tasksResult.value.tasks.map((t) => ({
      id: t.id,
      displayId: t.displayId,
      branches: linked.get(t.id) ?? []
    }))
    const messages: string[] = []
    let action: ProjectAction | undefined

    let localBranches: string[] = []
    let local = true
    try {
      localBranches = await this.deps.git.localBranches(project.localPath)
    } catch {
      local = false
      messages.push(SIGNALS_MESSAGES.local)
    }

    let github: SignalsGitHubState = 'ok'
    let remoteBranches: string[] | null = null
    let pulls: PullRequestSummary[] | null = null
    let details = new Map<number, PullRequestDetails>()
    const read = async (
      api: GitHubSignalsApi,
      via: 'app' | 'gh',
      owner: string,
      name: string
    ): Promise<void> => {
      const r = await this.readRemote(projectId, tasks, api, via, owner, name, options.force)
      github = r.github
      messages.push(...r.messages)
      if (r.action) action = r.action
      remoteBranches = r.remoteBranches
      pulls = r.pulls
      details = r.details
    }
    const repo = githubRepoOf(project)
    if (!project.repo) {
      github = 'no_repo'
      messages.push(SIGNALS_MESSAGES.noRepo)
    } else if (repoAccess(project.repo) === 'git') {
      // Só git local: o GitHub vem pelo `gh` do usuário (se instalado e logado).
      const gitRepo = gitRepoOf(project)
      const gh = this.deps.gh
      const status = gh && gitRepo ? await gh.status().catch(() => null) : null
      if (gh && gitRepo && status?.ok) await read(gh, 'gh', gitRepo.owner, gitRepo.name)
      else {
        github = 'git_only'
        messages.push(status && !status.ok ? status.message : SIGNALS_MESSAGES.gitOnly)
      }
    } else if (!repo) {
      github = 'enterprise'
      messages.push(SIGNALS_MESSAGES.enterprise)
    } else if (!(await this.deps.github.isConnected().catch(() => false))) {
      github = 'disconnected'
      messages.push(SIGNALS_MESSAGES.disconnected)
    } else {
      await read(this.deps.github, 'app', repo.owner, repo.name)
    }

    const signals = buildTaskSignals(tasks, { localBranches, remoteBranches, pulls, details })
    const result: TaskSignalsResult = {
      signals,
      github,
      local,
      messages,
      // Só IDs numéricos sem prefixo; banco sem a propriedade de ID liga pelas branches registradas.
      tasksWithoutPrefix: tasks.filter((t) => t.displayId && !parseDisplayId(t.displayId)).length,
      fetchedAt: this.now().toISOString()
    }
    if (action) result.action = action
    this.lastResults.set(projectId, result)
    return { ok: true, value: result }
  }

  /** Último resultado conhecido do projeto (sem rede); `null` se ainda não houve leitura. */
  cached(projectId: string): TaskSignalsResult | null {
    return this.lastResults.get(projectId) ?? null
  }

  /** PRs do repositório no último resultado do GitHub (abertas e fechadas há até 30 dias). */
  cachedPulls(projectId: string): PullRequestSummary[] | null {
    return this.lastRemote(projectId)?.pulls ?? null
  }

  /** PR aberta (ou rascunho) mais recente da branch, pelo último resultado conhecido (sem rede). */
  prForBranch(projectId: string, branch: string): PullRequestSummary | null {
    return (
      this.lastRemote(projectId)
        ?.pulls.filter((p) => p.headRef === branch && (p.state === 'open' || p.state === 'draft'))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    )
  }

  /**
   * PR já mergeada desta branch (sem PR aberta nela), do último resultado remoto (sem rede):
   * trabalho novo da tarefa vai numa branch nova (worktree).
   */
  mergedPrForBranch(projectId: string, branch: string): number | null {
    const pulls = this.lastRemote(projectId)?.pulls.filter((p) => p.headRef === branch) ?? []
    if (pulls.some((p) => p.state === 'open' || p.state === 'draft')) return null
    return pulls.find((p) => p.state === 'merged')?.number ?? null
  }

  /** Último resultado remoto do projeto, pela API do Orkio ou pelo `gh` (projeto só git). */
  private lastRemote(projectId: string): RemoteState['last'] {
    const target = readRepoOf(projectById(this.deps.store.get(), projectId))
    if (!target) return null
    return (
      this.remotes.get(remoteKey(projectId, target.via, target.owner, target.name))?.last ?? null
    )
  }

  private async readRemote(
    projectId: string,
    tasks: Parameters<typeof buildTaskSignals>[0],
    api: GitHubSignalsApi,
    via: 'app' | 'gh',
    owner: string,
    name: string,
    force: boolean | undefined
  ): Promise<{
    github: SignalsGitHubState
    messages: string[]
    action?: ProjectAction
    remoteBranches: string[] | null
    pulls: PullRequestSummary[] | null
    details: Map<number, PullRequestDetails>
  }> {
    const key = remoteKey(projectId, via, owner, name)
    let state = this.remotes.get(key)
    if (!state) {
      state = {
        repo: new GitHubRepoSignals(api, owner, name, () => this.now().getTime()),
        last: null
      }
      this.remotes.set(key, state)
    }
    const interval =
      via === 'gh' ? (this.deps.ghIntervalMs ?? GH_SIGNALS_INTERVAL_MS) : this.minInterval
    const fresh = !force && state.last && this.now().getTime() - state.last.at < interval
    const messages: string[] = []
    let github: SignalsGitHubState = 'ok'
    let action: ProjectAction | undefined
    let remoteBranches: string[] | null = null
    let pulls: PullRequestSummary[] | null = null
    let details = new Map<number, PullRequestDetails>()
    try {
      if (!fresh) {
        const snapshot = await state.repo.snapshot()
        state.last = {
          branches: snapshot.branches,
          pulls: snapshot.pulls,
          at: this.now().getTime()
        }
        if (snapshot.branchesTruncated) {
          messages.push('O repositório tem muitas branches; mostramos as 1000 primeiras.')
        }
      }
      remoteBranches = state.last!.branches
      pulls = state.last!.pulls
    } catch (e) {
      const failure = await this.failure(e, via)
      github = failure.state
      messages.push(failure.message)
      if (failure.action) action = failure.action
      if (state.last) {
        remoteBranches = state.last.branches
        pulls = state.last.pulls
        messages.push(SIGNALS_MESSAGES.stale)
      }
    }
    if (pulls) {
      const linked = buildTaskSignals(tasks, {
        localBranches: [],
        remoteBranches: [],
        pulls,
        details: new Map()
      })
      const numbers = new Set(Object.values(linked).flatMap((s) => (s.pr ? [s.pr.number] : [])))
      details = new Map(await state.repo.pullDetails(pulls.filter((p) => numbers.has(p.number))))
      if (state.repo.detailsWarning) messages.push(state.repo.detailsWarning)
    }
    return { github, messages, ...(action ? { action } : {}), remoteBranches, pulls, details }
  }

  private async failure(
    e: unknown,
    via: 'app' | 'gh' = 'app'
  ): Promise<{ state: SignalsGitHubState; message: string; action?: ProjectAction }> {
    if (!isApiError(e, 'github')) return { state: 'unverified', message: SIGNALS_MESSAGES.unknown }
    switch (e.code) {
      case 'not_connected':
        // Pelo `gh`: o motivo dele (não instalado, sem login), não "conecte em Integrações".
        return via === 'gh'
          ? { state: 'git_only', message: e.message }
          : { state: 'disconnected', message: SIGNALS_MESSAGES.disconnected }
      case 'not_found':
      case 'forbidden':
      case 'unauthorized':
        return { state: 'no_access', message: e.message }
      case 'sso_required':
        return {
          state: 'sso',
          message: e.message,
          ...(e.details.ssoUrl ? { action: { label: 'Autorizar SSO', url: e.details.ssoUrl } } : {})
        }
      case 'oauth_restricted':
        return {
          state: 'restricted',
          message: e.message,
          action: {
            label: 'Pedir aprovação',
            url: await this.deps.github
              .accessSettingsUrl()
              .catch(() => 'https://github.com/settings/connections/applications')
          }
        }
      case 'rate_limited':
        return { state: 'rate_limited', message: e.message }
      default:
        return { state: 'unverified', message: e.message }
    }
  }
}

const remoteKey = (projectId: string, via: 'app' | 'gh', owner: string, name: string): string =>
  `${projectId}:${via}:${owner}/${name}`.toLowerCase()

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { OrkioConfig, StoredProject } from '../config/orkio-config'
import { type GitHubRepo } from '../connectors/github/github.client'
import { GitError, type Git } from '../git/git'
import { ConfigReadOnlyError, type ConfigStore } from '../storage/config-store'
import { HeadWatcher } from './head-watcher'
import { parseRemoteUrl, sameRepo } from './remote-url'
import type {
  BranchChangedEvent,
  CreateProjectInput,
  PickFolderResult,
  ProjectAction,
  ProjectError,
  ProjectErrorCode,
  ProjectHealth,
  ProjectMutationResult,
  ProjectNotice,
  ProjectRepo,
  ProjectSelection,
  ProjectView,
  ProjectsListResult,
  RemoteCandidate
} from '../../shared/projects'
import { isApiError, isTransientApiError } from '../net/http'

/** O que o serviço precisa do conector do GitHub (o token nunca sai de lá). */
export interface ProjectsGitHub {
  isConnected(): Promise<boolean>
  getRepository(owner: string, name: string): Promise<GitHubRepo>
  accessSettingsUrl(): Promise<string>
}

export interface HeadWatcherLike {
  start(): Promise<string | null>
  stop(): void
}

export interface ProjectsServiceDeps {
  store: ConfigStore<OrkioConfig>
  /** Só o que Projetos usa do git (as operações de worktree ficam com a 4A). */
  git: Pick<
    Git,
    | 'showToplevel'
    | 'absoluteGitDir'
    | 'remotes'
    | 'currentBranch'
    | 'isDirty'
    | 'remoteDefaultBranch'
  >
  github: ProjectsGitHub
  /** Abre o seletor de pasta do sistema (no main). `null` = cancelado. */
  pickFolder(purpose: 'add' | 'relocate'): Promise<string | null>
  folderExists(path: string): Promise<boolean>
  /** Resolve links simbólicos para comparar caminhos. */
  realpath(path: string): Promise<string>
  createHeadWatcher?: (
    gitDir: string,
    handlers: { onBranchChange(branch: string | null): void; onError(): void }
  ) => HeadWatcherLike
  now?: () => Date
  newId?: () => string
  selectionTtlMs?: number
  /** Chamadas simultâneas ao GitHub na revalidação. */
  concurrency?: number
}

interface Selection {
  root: string
  candidates: RemoteCandidate[]
  branch: string | null
  dirty: boolean
  expiresAt: number
}

interface LocalState {
  health: ProjectHealth | null
  local: ProjectView['local']
  gitDir: string | null
}

const MAX_NAME_LENGTH = 80

export class ProjectsService {
  private readonly selections = new Map<string, Selection>()
  private readonly watchers = new Map<string, { gitDir: string; watcher: HeadWatcherLike }>()
  /** Último resultado da checagem no GitHub, por projeto (só em memória). */
  private readonly remoteHealth = new Map<string, ProjectHealth>()
  private readonly branchListeners = new Set<(event: BranchChangedEvent) => void>()
  /** Os HeadWatchers só existem entre `watch()` e `dispose()`. */
  private watching = false
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: ProjectsServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? randomUUID
  }

  /** Troca de branch (HeadWatcher) de qualquer projeto. Devolve a função que desliga. */
  onBranchChanged(listener: (event: BranchChangedEvent) => void): () => void {
    this.branchListeners.add(listener)
    return () => this.branchListeners.delete(listener)
  }

  /**
   * Liga os HeadWatchers de todos os projetos (eventos de branch na hora). A partir daqui, projeto
   * adicionado, reapontado ou removido liga/troca/desliga o seu; `list()` nunca mexe neles.
   */
  async watch(): Promise<void> {
    this.watching = true
    await mapLimit(this.projects(), 4, async (project) =>
      this.follow(project.id, await this.localState(project))
    )
  }

  /** Rápido: só checagens locais (pasta, repo, branch, sujeira). */
  async list(): Promise<ProjectsListResult> {
    const projects = this.projects()
    const views = await mapLimit(projects, 4, async (project) => {
      const local = await this.localState(project)
      return this.view(project, local, this.remoteHealth.get(project.id))
    })
    return this.result(views)
  }

  /** Checagens locais + GitHub (branch padrão, visibilidade, push, acesso). */
  async revalidate(): Promise<ProjectsListResult> {
    const connected = await this.deps.github.isConnected().catch(() => false)
    const views = await mapLimit(this.projects(), this.deps.concurrency ?? 3, async (project) => {
      const local = await this.localState(project)
      let current = this.findProject(project.id) ?? project
      if (!local.health && current.repo) {
        const checked = await this.checkRemote(current, connected)
        this.remoteHealth.set(project.id, checked.health)
        if (checked.repo) current = (await this.saveRepo(current, checked.repo)) ?? current
      }
      return this.view(current, local, this.remoteHealth.get(project.id))
    })
    return this.result(views)
  }

  async pickFolder(): Promise<PickFolderResult> {
    const folder = await this.deps.pickFolder('add')
    if (!folder) return { ok: false, cancelled: true }

    const detected = await this.detect(folder)
    if (!detected.ok) return { ok: false, cancelled: false, error: detected.error }
    const { root } = detected

    const existing = this.projects().find((p) => samePath(p.localPath, root))
    if (existing) {
      return fail('already_added', `Esta pasta já está no Orkio como “${existing.name}”.`)
    }

    this.pruneSelections()
    const selectionId = this.newId()
    this.selections.set(selectionId, {
      root,
      candidates: detected.candidates,
      branch: detected.branch,
      dirty: detected.dirty,
      expiresAt: this.now().getTime() + (this.deps.selectionTtlMs ?? 10 * 60_000)
    })
    const selection: ProjectSelection = {
      selectionId,
      rootPath: root,
      folderName: basename(root),
      resolvedFromSubfolder: detected.resolvedFromSubfolder,
      branch: detected.branch,
      dirty: detected.dirty,
      candidates: detected.candidates,
      suggestedRemote: detected.candidates[0]!.remoteName
    }
    return { ok: true, selection }
  }

  async create(input: CreateProjectInput): Promise<ProjectMutationResult> {
    this.pruneSelections()
    const selection = this.selections.get(input.selectionId)
    if (!selection) {
      return fail('selection_expired', 'A seleção expirou. Escolha a pasta de novo.')
    }
    const candidate = selection.candidates.find((c) => c.remoteName === input.remoteName)
    if (!candidate) return fail('not_github', 'Escolha um dos remotes do GitHub listados.')
    if (candidate.hostKind !== 'github' && !input.hostConfirmed) {
      return fail(
        'host_unconfirmed',
        `Confirme que ${candidate.host} é um endereço do GitHub para continuar.`
      )
    }

    const name = (input.name ?? '').trim() || candidate.name
    if (name.length > MAX_NAME_LENGTH) {
      return fail('invalid_name', `Use um nome com até ${MAX_NAME_LENGTH} caracteres.`)
    }
    if (this.projects().some((p) => samePath(p.localPath, selection.root))) {
      return fail('already_added', 'Esta pasta já está no Orkio.')
    }

    const resolved = await this.resolveRepo(selection.root, candidate)
    if (!resolved.ok) return { ok: false, cancelled: false, error: resolved.error }

    const timestamp = this.now().toISOString()
    const project: StoredProject = {
      id: this.newId(),
      name,
      localPath: selection.root,
      repo: resolved.repo,
      createdAt: timestamp,
      updatedAt: timestamp,
      notionProject: null
    }
    try {
      await this.deps.store.update((config) => ({
        ...config,
        projects: [...config.projects, project]
      }))
    } catch (error) {
      return storageFailure(error)
    }
    this.selections.delete(input.selectionId)
    this.remoteHealth.set(project.id, { state: 'ok' })

    const local = await this.localState(project)
    this.follow(project.id, local)
    return { ok: true, project: this.view(project, local, this.remoteHealth.get(project.id)) }
  }

  async relocate(projectId: string): Promise<ProjectMutationResult> {
    const project = this.findProject(projectId)
    if (!project) return fail('project_not_found', 'Projeto não encontrado.')

    const folder = await this.deps.pickFolder('relocate')
    if (!folder) return { ok: false, cancelled: true }
    const detected = await this.detect(folder)
    if (!detected.ok) return { ok: false, cancelled: false, error: detected.error }

    const match = project.repo
      ? detected.candidates.find((c) => sameRepo(c, project.repo!))
      : detected.candidates[0]
    if (!match) {
      const found = detected.candidates[0]!
      return fail(
        'repo_mismatch',
        `Essa pasta é do repositório ${found.owner}/${found.name}, não de ${project.repo!.owner}/${project.repo!.name}.`
      )
    }
    const other = this.projects().find(
      (p) => p.id !== projectId && samePath(p.localPath, detected.root)
    )
    if (other) return fail('already_added', `Esta pasta já está no Orkio como “${other.name}”.`)

    let updated: StoredProject = {
      ...project,
      localPath: detected.root,
      repo: project.repo ? { ...project.repo, remoteName: match.remoteName } : project.repo,
      updatedAt: this.now().toISOString()
    }
    try {
      await this.deps.store.update((config) => ({
        ...config,
        // Mantém campos alterados em paralelo (ex.: vínculo com o Notion).
        projects: config.projects.map((p) =>
          p.id === projectId
            ? (updated = {
                ...p,
                localPath: updated.localPath,
                repo: updated.repo,
                updatedAt: updated.updatedAt
              })
            : p
        )
      }))
    } catch (error) {
      return storageFailure(error)
    }
    this.stopWatcher(projectId)

    const local = await this.localState(updated)
    this.follow(projectId, local)
    if (!local.health && updated.repo) {
      const connected = await this.deps.github.isConnected().catch(() => false)
      const checked = await this.checkRemote(updated, connected)
      this.remoteHealth.set(projectId, checked.health)
      if (checked.repo) updated = (await this.saveRepo(updated, checked.repo)) ?? updated
    }
    return { ok: true, project: this.view(updated, local, this.remoteHealth.get(projectId)) }
  }

  /** Só remove do Orkio: nenhum arquivo é tocado. */
  /** Arquiva ou desarquiva (nada é apagado; o quadro, os fluxos e o histórico ficam). */
  async setArchived(projectId: string, archived: boolean): Promise<{ ok: boolean }> {
    if (!this.findProject(projectId)) return { ok: false }
    try {
      await this.deps.store.update((config) => ({
        ...config,
        projects: config.projects.map((p) => {
          if (p.id !== projectId) return p
          const next = { ...p }
          // Ativo = sem o campo (o formato antigo continua igual no disco).
          if (archived) next.archived = true
          else delete next.archived
          return next
        })
      }))
    } catch {
      return { ok: false }
    }
    return { ok: true }
  }

  async remove(projectId: string): Promise<{ ok: boolean }> {
    if (!this.findProject(projectId)) return { ok: false }
    try {
      await this.deps.store.update((config) => ({
        ...config,
        projects: config.projects.filter((p) => p.id !== projectId)
      }))
    } catch {
      return { ok: false }
    }
    this.stopWatcher(projectId)
    this.remoteHealth.delete(projectId)
    return { ok: true }
  }

  dispose(): void {
    this.watching = false
    for (const id of [...this.watchers.keys()]) this.stopWatcher(id)
  }

  private projects(): StoredProject[] {
    return this.deps.store.get().projects
  }

  private findProject(id: string): StoredProject | undefined {
    return this.projects().find((p) => p.id === id)
  }

  private result(projects: ProjectView[]): ProjectsListResult {
    const warning = this.deps.store.loadWarning
    return warning ? { projects, warning } : { projects }
  }

  private async detect(folder: string): Promise<
    | {
        ok: true
        root: string
        resolvedFromSubfolder: boolean
        candidates: RemoteCandidate[]
        branch: string | null
        dirty: boolean
      }
    | { ok: false; error: ProjectError }
  > {
    let root: string
    try {
      root = await this.deps.git.showToplevel(folder)
    } catch (error) {
      return { ok: false, error: gitFailure(error) }
    }

    try {
      const [remotes, branch, dirty, folderReal, rootReal] = await Promise.all([
        this.deps.git.remotes(root),
        this.deps.git.currentBranch(root),
        this.deps.git.isDirty(root),
        this.deps.realpath(folder).catch(() => folder),
        this.deps.realpath(root).catch(() => root)
      ])
      if (remotes.length === 0) {
        return {
          ok: false,
          error: {
            code: 'no_remote',
            message:
              'Este repositório não tem remote. Publique-o no GitHub (git remote add origin …) e tente de novo.'
          }
        }
      }
      const candidates = orderCandidates(
        remotes.flatMap((remote) => {
          const parsed = parseRemoteUrl(remote.url)
          return parsed
            ? [
                {
                  remoteName: remote.name,
                  host: parsed.host,
                  owner: parsed.owner,
                  name: parsed.name,
                  hostKind: parsed.kind
                }
              ]
            : []
        })
      )
      if (candidates.length === 0) {
        return {
          ok: false,
          error: {
            code: 'not_github',
            message: `Nenhum remote deste repositório aponta para o GitHub (${describeRemote(remotes[0]!.url)}).`
          }
        }
      }
      return {
        ok: true,
        root,
        resolvedFromSubfolder: !samePath(folderReal, rootReal),
        candidates,
        branch,
        dirty
      }
    } catch (error) {
      return { ok: false, error: gitFailure(error) }
    }
  }

  private async resolveRepo(
    root: string,
    candidate: RemoteCandidate
  ): Promise<{ ok: true; repo: ProjectRepo } | { ok: false; error: ProjectError }> {
    if (candidate.hostKind === 'enterprise') {
      // A conta conectada é do github.com: GitHub Enterprise fica salvo sem verificação.
      return {
        ok: true,
        repo: {
          host: candidate.host,
          owner: candidate.owner,
          name: candidate.name,
          remoteName: candidate.remoteName,
          defaultBranch: await this.deps.git.remoteDefaultBranch(root, candidate.remoteName),
          visibility: 'unknown',
          canPush: null,
          archived: false,
          verified: false
        }
      }
    }

    if (!(await this.deps.github.isConnected().catch(() => false))) {
      return {
        ok: false,
        error: {
          code: 'github_disconnected',
          message: 'Conecte sua conta do GitHub em Integrações para adicionar projetos.'
        }
      }
    }
    try {
      const repo = await this.deps.github.getRepository(candidate.owner, candidate.name)
      return { ok: true, repo: toProjectRepo(repo, candidate.remoteName) }
    } catch (error) {
      return { ok: false, error: await this.githubFailure(error) }
    }
  }

  private async checkRemote(
    project: StoredProject,
    connected: boolean
  ): Promise<{ health: ProjectHealth; repo?: ProjectRepo }> {
    const repo = project.repo!
    if (!repo.verified) return { health: { state: 'ok' } }
    if (!connected) {
      return {
        health: {
          state: 'github_disconnected',
          message: 'GitHub desconectado: não foi possível confirmar o acesso ao repositório.'
        }
      }
    }
    try {
      const fresh = await this.deps.github.getRepository(repo.owner, repo.name)
      return { health: { state: 'ok' }, repo: toProjectRepo(fresh, repo.remoteName) }
    } catch (error) {
      if (isApiError(error) && isTransientApiError(error, 'github')) {
        return {
          health: {
            state: 'unverified',
            message: `Não foi possível verificar no GitHub agora. ${error.message}`
          }
        }
      }
      const failure = await this.githubFailure(error)
      return {
        health: {
          state: 'no_access',
          message: failure.message,
          ...(failure.action ? { action: failure.action } : {})
        }
      }
    }
  }

  private async saveRepo(project: StoredProject, repo: ProjectRepo): Promise<StoredProject | null> {
    if (JSON.stringify(project.repo) === JSON.stringify(repo)) return project
    let updated: StoredProject = { ...project, repo, updatedAt: this.now().toISOString() }
    try {
      await this.deps.store.update((config) => ({
        ...config,
        projects: config.projects.map((p) =>
          p.id === project.id ? (updated = { ...p, repo, updatedAt: updated.updatedAt }) : p
        )
      }))
      return updated
    } catch {
      return null
    }
  }

  private async githubFailure(error: unknown): Promise<ProjectError> {
    if (!isApiError(error, 'github')) {
      return {
        code: 'github_error',
        message: 'Algo deu errado ao falar com o GitHub. Tente de novo.'
      }
    }
    const settings = async (): Promise<ProjectAction> => ({
      label: 'Abrir configurações de acesso do GitHub',
      url: await this.deps.github.accessSettingsUrl()
    })
    switch (error.code) {
      case 'not_connected':
        return { code: 'github_disconnected', message: error.message }
      case 'not_found':
        return { code: 'no_access', message: error.message }
      case 'sso_required':
        return {
          code: 'sso_required',
          message: error.message,
          action: error.details.ssoUrl
            ? { label: 'Autorizar SSO da organização', url: error.details.ssoUrl }
            : await settings()
        }
      case 'oauth_restricted':
        return { code: 'oauth_restricted', message: error.message, action: await settings() }
      case 'unauthorized':
        return {
          code: 'no_access',
          message: 'A conexão com o GitHub não vale mais. Reconecte o GitHub em Integrações.'
        }
      case 'forbidden':
        return { code: 'no_access', message: error.message, action: await settings() }
      default:
        return { code: 'github_error', message: error.message }
    }
  }

  private async localState(project: StoredProject): Promise<LocalState> {
    const missing: LocalState = {
      health: {
        state: 'missing_folder',
        message: 'Pasta não encontrada. Ela foi movida ou apagada?'
      },
      local: null,
      gitDir: null
    }
    if (!(await this.deps.folderExists(project.localPath).catch(() => false))) return missing

    try {
      const root = await this.deps.git.showToplevel(project.localPath)
      const [rootReal, pathReal] = await Promise.all([
        this.deps.realpath(root).catch(() => root),
        this.deps.realpath(project.localPath).catch(() => project.localPath)
      ])
      if (!samePath(rootReal, pathReal)) {
        return {
          health: {
            state: 'not_a_repo',
            message: 'A pasta não é mais a raiz de um repositório git.'
          },
          local: null,
          gitDir: null
        }
      }

      const [remotes, branch, dirty, gitDir] = await Promise.all([
        this.deps.git.remotes(root),
        this.deps.git.currentBranch(root),
        this.deps.git.isDirty(root),
        this.deps.git.absoluteGitDir(root)
      ])
      let health: ProjectHealth | null = null
      if (project.repo) {
        const parsed = remotes.map((r) => parseRemoteUrl(r.url)).filter((p) => p !== null)
        if (!parsed.some((p) => sameRepo(p, project.repo!))) {
          const now = parsed[0]
          health = {
            state: 'repo_mismatch',
            message: now
              ? `A pasta agora aponta para ${now.owner}/${now.name}, não para ${project.repo.owner}/${project.repo.name}.`
              : `Nenhum remote da pasta aponta mais para ${project.repo.owner}/${project.repo.name}.`
          }
        }
      }
      return { health, local: { branch, dirty }, gitDir }
    } catch (error) {
      const failure = gitFailure(error)
      if (
        failure.code === 'git_error' &&
        error instanceof GitError &&
        error.code === 'folder_not_found'
      ) {
        return missing
      }
      return {
        health: {
          state: failure.code === 'not_a_repo' ? 'not_a_repo' : 'git_error',
          message:
            failure.code === 'not_a_repo'
              ? 'A pasta não é mais um repositório git.'
              : failure.message
        },
        local: null,
        gitDir: null
      }
    }
  }

  /** Com `watch()` ligado: o watcher acompanha o repositório da pasta (ou para, sem repositório). */
  private follow(projectId: string, local: LocalState): void {
    if (!this.watching) return
    if (local.gitDir) this.ensureWatcher(projectId, local.gitDir)
    else this.stopWatcher(projectId)
  }

  private ensureWatcher(projectId: string, gitDir: string): void {
    const current = this.watchers.get(projectId)
    if (current?.gitDir === gitDir) return
    this.stopWatcher(projectId)
    const create =
      this.deps.createHeadWatcher ??
      ((dir, handlers) =>
        new HeadWatcher({
          gitDir: dir,
          onBranchChange: handlers.onBranchChange,
          onError: handlers.onError
        }))
    const watcher = create(gitDir, {
      onBranchChange: (branch) => {
        for (const listener of this.branchListeners) listener({ projectId, branch })
      },
      onError: () => this.stopWatcher(projectId)
    })
    this.watchers.set(projectId, { gitDir, watcher })
    void watcher.start().catch(() => this.stopWatcher(projectId))
  }

  private stopWatcher(projectId: string): void {
    this.watchers.get(projectId)?.watcher.stop()
    this.watchers.delete(projectId)
  }

  private pruneSelections(): void {
    const now = this.now().getTime()
    for (const [id, selection] of this.selections) {
      if (selection.expiresAt <= now) this.selections.delete(id)
    }
  }

  private view(
    project: StoredProject,
    local: LocalState,
    remote: ProjectHealth | undefined
  ): ProjectView {
    return {
      id: project.id,
      name: project.name,
      localPath: project.localPath,
      repo: project.repo,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      local: local.local,
      health: local.health ?? remote ?? { state: 'checking' },
      notices: noticesFor(project.repo),
      notionProject: project.notionProject,
      archived: project.archived === true
    }
  }
}

export function noticesFor(repo: ProjectRepo | null): ProjectNotice[] {
  if (!repo) return []
  const notices: ProjectNotice[] = []
  if (!repo.verified) {
    notices.push({
      code: 'enterprise_unverified',
      message: `GitHub Enterprise (${repo.host}) ainda não é suportado: o repositório não foi verificado.`
    })
  }
  if (repo.archived) {
    notices.push({
      code: 'archived',
      message: 'Repositório arquivado no GitHub: o Orkio não poderá abrir PRs nele.'
    })
  }
  if (repo.verified && repo.canPush === false && !repo.archived) {
    notices.push({
      code: 'no_push',
      message:
        'Sua conta não tem permissão de push neste repositório: o Orkio não poderá abrir PRs.'
    })
  }
  return notices
}

function toProjectRepo(repo: GitHubRepo, remoteName: string): ProjectRepo {
  return {
    host: 'github.com',
    owner: repo.owner,
    name: repo.name,
    remoteName,
    defaultBranch: repo.defaultBranch,
    visibility: repo.visibility,
    canPush: repo.canPush,
    archived: repo.archived,
    verified: true
  }
}

/** origin primeiro, depois upstream (fork), depois o resto em ordem alfabética. */
function orderCandidates(candidates: RemoteCandidate[]): RemoteCandidate[] {
  const rank = (name: string): number => (name === 'origin' ? 0 : name === 'upstream' ? 1 : 2)
  return [...candidates].sort(
    (a, b) => rank(a.remoteName) - rank(b.remoteName) || a.remoteName.localeCompare(b.remoteName)
  )
}

function describeRemote(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    const scp = /^(?:[^@]+@)?([^:]+):/.exec(url)
    return scp?.[1] ?? 'remote local'
  }
}

function gitFailure(error: unknown): ProjectError {
  if (error instanceof GitError) {
    const code: ProjectErrorCode =
      error.code === 'not_a_repo'
        ? 'not_a_repo'
        : error.code === 'git_not_found'
          ? 'git_not_found'
          : 'git_error'
    return { code, message: error.message }
  }
  return { code: 'git_error', message: 'O git retornou um erro ao ler esta pasta.' }
}

function fail(
  code: ProjectErrorCode,
  message: string
): { ok: false; cancelled: false; error: ProjectError } {
  return { ok: false, cancelled: false, error: { code, message } }
}

function storageFailure(error: unknown): { ok: false; cancelled: false; error: ProjectError } {
  return fail(
    'storage',
    error instanceof ConfigReadOnlyError
      ? 'As configurações estão em modo somente leitura (versão mais nova do Orkio). Nada foi salvo.'
      : 'Não foi possível salvar o projeto. Tente de novo.'
  )
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '')
  return process.platform === 'win32' || process.platform === 'darwin'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b)
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

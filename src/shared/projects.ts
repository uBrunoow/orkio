/**
 * Projetos locais: repositório, saúde, seleção da pasta e erros. `ProjectRepo` também é o formato
 * salvo em disco (`orkio-config.json`): mudar aqui pede migração.
 */

export interface ProjectRepo {
  /** Host da API: github.com (inclusive para aliases de SSH) ou o host do GitHub Enterprise. */
  host: string
  owner: string
  name: string
  /** Remote local que aponta para este repositório (ex.: origin). */
  remoteName: string
  defaultBranch: string | null
  visibility: 'public' | 'private' | 'internal' | 'unknown'
  /** `null` quando não foi possível verificar (ex.: GitHub Enterprise). */
  canPush: boolean | null
  archived: boolean
  /** Confirmado na API do GitHub com a conta conectada. */
  verified: boolean
  /**
   * Como o Orkio fala com o GitHub deste repositório: `app` (padrão, campo ausente) = pela conexão
   * do GitHub do Orkio; `git` = só o git e o `gh` desta máquina (nada de API do Orkio: para repos de
   * organização sem o OAuth App aprovado).
   */
  access?: RepoAccess
}

export type RepoAccess = 'app' | 'git'

/** Modo do repositório (ausente = `app`, o formato antigo continua igual no disco). */
export function repoAccess(repo: ProjectRepo): RepoAccess {
  return repo.access ?? 'app'
}

/** Repositório no github.com, nas coordenadas da API (`api.github.com`). */
export interface GitHubRepoRef {
  owner: string
  name: string
}

/**
 * O repositório do projeto no github.com, ou `null` (sem repositório, GitHub Enterprise ou não
 * verificado). Regra única para sinais, histórico, aba Revisão, revisão publicada e entrega:
 * `verified` é o que diz que a conta conectada alcançou o repositório na API do github.com
 * (Projetos já trata o não verificado como Enterprise: sem revalidação e com aviso), e o host diz
 * que `owner/name` são coordenadas do github.com (o conector só fala com `api.github.com`).
 */
export function githubRepoOf(
  project: { repo: ProjectRepo | null } | null | undefined
): GitHubRepoRef | null {
  const repo = project?.repo
  if (!repo || !repo.verified || repoAccess(repo) === 'git') return null
  if (repo.host.toLowerCase() !== 'github.com') return null
  return { owner: repo.owner, name: repo.name }
}

/**
 * O repositório do projeto no github.com para quem só precisa do nome (entrega, links, regras do
 * push e do `gh`): verificado pela API (`app`) ou só com git local (`git`). Os sinais, a aba Revisão
 * e a revisão publicada continuam no `githubRepoOf` (precisam da API do Orkio).
 */
export function gitRepoOf(
  project: { repo: ProjectRepo | null } | null | undefined
): GitHubRepoRef | null {
  const repo = project?.repo
  if (!repo || repo.host.toLowerCase() !== 'github.com') return null
  if (!repo.verified && repoAccess(repo) !== 'git') return null
  return { owner: repo.owner, name: repo.name }
}

/**
 * De onde o projeto lê o GitHub (sinais, aba Revisão, automações, revisão publicada): `app` = API
 * do Orkio (verificado, `githubRepoOf`); `gh` = o GitHub CLI do usuário (só git local no
 * github.com). `null` = só local (sem repositório, Enterprise, não verificado).
 */
export function readRepoOf(
  project: { repo: ProjectRepo | null } | null | undefined
): (GitHubRepoRef & { via: 'app' | 'gh' }) | null {
  const app = githubRepoOf(project)
  if (app) return { via: 'app', ...app }
  const repo = project?.repo
  const git = repo && repoAccess(repo) === 'git' ? gitRepoOf(project) : null
  return git ? { via: 'gh', ...git } : null
}

/** Link externo oferecido junto de um erro/estado (sempre dentro da allowlist do main). */
export interface ProjectAction {
  label: string
  url: string
}

export type ProjectHealthState =
  | 'checking'
  | 'ok'
  | 'missing_folder'
  | 'not_a_repo'
  | 'repo_mismatch'
  | 'no_access'
  | 'github_disconnected'
  | 'unverified'
  | 'git_error'

/** Pasta com problema (some, deixou de ser repositório, aponta para outro, git falhando). */
export const FOLDER_PROBLEM_STATES: readonly ProjectHealthState[] = [
  'missing_folder',
  'not_a_repo',
  'repo_mismatch',
  'git_error'
]

export function isFolderProblem(state: ProjectHealthState): boolean {
  return FOLDER_PROBLEM_STATES.includes(state)
}

export interface ProjectHealth {
  state: ProjectHealthState
  message?: string
  action?: ProjectAction
}

export interface ProjectNotice {
  code: 'archived' | 'no_push' | 'enterprise_unverified'
  message: string
}

export interface ProjectView {
  id: string
  name: string
  /** Só para exibição: o renderer nunca envia caminhos de volta ao main. */
  localPath: string
  repo: ProjectRepo | null
  createdAt: string
  updatedAt: string
  /** Estado local do git; `null` quando a pasta/repositório não está acessível. */
  local: { branch: string | null; dirty: boolean } | null
  health: ProjectHealth
  notices: ProjectNotice[]
  /** Projeto do Notion vinculado (página do banco de Projetos). */
  notionProject: { id: string; name: string } | null
  /** Arquivado: guardado, fora do quadro, da lista lateral e das automações. */
  archived: boolean
}

export interface ProjectsListResult {
  projects: ProjectView[]
  /** Ex.: configuração corrompida recuperada, modo só leitura. */
  warning?: string
}

export interface RemoteCandidate {
  remoteName: string
  /** Host como aparece no remote. */
  host: string
  owner: string
  name: string
  /** `ssh-alias` e `enterprise` exigem confirmação do usuário de que é GitHub. */
  hostKind: 'github' | 'ssh-alias' | 'enterprise'
}

/** Pasta escolhida no diálogo do main, já analisada. As próximas chamadas usam `selectionId`. */
export interface ProjectSelection {
  selectionId: string
  rootPath: string
  folderName: string
  /** A pasta escolhida era uma subpasta; usamos a raiz do repositório. */
  resolvedFromSubfolder: boolean
  branch: string | null
  dirty: boolean
  candidates: RemoteCandidate[]
  suggestedRemote: string
}

export type ProjectErrorCode =
  | 'not_a_repo'
  | 'no_remote'
  | 'not_github'
  | 'git_not_found'
  | 'git_error'
  | 'github_disconnected'
  | 'no_access'
  | 'sso_required'
  | 'oauth_restricted'
  | 'host_unconfirmed'
  | 'selection_expired'
  | 'already_added'
  | 'repo_mismatch'
  | 'project_not_found'
  | 'invalid_name'
  | 'storage'
  | 'github_error'

export interface ProjectError {
  code: ProjectErrorCode
  message: string
  action?: ProjectAction
}

export type PickFolderResult =
  | { ok: true; selection: ProjectSelection }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ProjectError }

export interface CreateProjectInput {
  selectionId: string
  remoteName: string
  /** O usuário confirmou que um host de alias/Enterprise é GitHub. */
  hostConfirmed: boolean
  name?: string
  /** Salvar só com o git desta máquina, sem consultar a API do GitHub do Orkio. */
  gitOnly?: boolean
}

export type ProjectMutationResult =
  | { ok: true; project: ProjectView }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: ProjectError }

export interface BranchChangedEvent {
  projectId: string
  branch: string | null
}

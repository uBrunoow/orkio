/**
 * Entrega (Etapa 5C): push da branch da tarefa pelo Orkio e o alvo do "modo entrega".
 *
 * - O alvo vem do worktree da tarefa (branch) e do projeto (owner/repo/remote/branch padrão).
 * - Push só da branch da tarefa (`checkPushBranch`), sem força, sem mudanças pendentes e com
 *   commits novos. Credenciais do próprio usuário (sem prompts: falha com mensagem clara).
 */
import { basename } from 'node:path'
import {
  DEFAULT_DELIVERY_SETTINGS,
  DELIVERY_MESSAGES,
  checkPushBranch,
  type DeliverySettings,
  type DeliveryTarget
} from '../../shared/delivery'
import type { StoredProject } from '../config/orkio-config'
import type { Git } from '../git/git'
import { GitError } from '../git/git'
import { DomainError } from '../errors'
import type { WorktreeRecord } from '../claude/worktree.service'
import { githubRepoOf } from '../../shared/projects'

export type DeliveryErrorCode =
  | 'no_project'
  | 'no_repo'
  | 'no_worktree'
  | 'branch'
  | 'dirty'
  | 'nothing'
  | 'credentials'
  | 'rejected'
  | 'git'

export class DeliveryError extends DomainError {
  override name = 'DeliveryError'
  constructor(
    override readonly code: DeliveryErrorCode,
    message: string
  ) {
    super(code, message)
  }
}

export const DELIVERY_SERVICE_MESSAGES = {
  noProject: 'Projeto não encontrado.',
  noWorktree:
    'Esta tarefa ainda não tem ambiente (worktree). Rode o Claude Code nela antes da entrega.',
  git: 'O git retornou um erro no push. Veja o terminal do projeto e tente de novo.'
} as const

export interface PushPreview {
  target: DeliveryTarget
  /** Commits que vão para o GitHub (hash curto + assunto). */
  commits: { hash: string; subject: string }[]
  /** `git diff --stat` do que vai (contra a branch remota, ou a base se ainda não existe). */
  stat: string
  /** A branch remota já existe? */
  remoteExists: boolean
  /** Mudanças não commitadas (linhas do `status --porcelain`). */
  pending: string[]
  /** Motivo para não fazer o push (`null` = pode), com o código do `DeliveryError` que o push lança. */
  problem: { code: DeliveryErrorCode; message: string } | null
  /** Link da branch no GitHub. */
  branchUrl: string
}

export interface DeliveryDeps {
  git: Git
  project(projectId: string): StoredProject | null
  worktree(taskId: string): WorktreeRecord | null
  settings(projectId: string): DeliverySettings | undefined
}

export class DeliveryService {
  constructor(private readonly deps: DeliveryDeps) {}

  settings(projectId: string): DeliverySettings {
    return this.deps.settings(projectId) ?? DEFAULT_DELIVERY_SETTINGS
  }

  /** Alvo da entrega da tarefa (lança `DeliveryError` sem repositório/ambiente). */
  target(projectId: string, taskId: string): DeliveryTarget & { worktree: WorktreeRecord } {
    const project = this.deps.project(projectId)
    if (!project) throw new DeliveryError('no_project', DELIVERY_SERVICE_MESSAGES.noProject)
    const repo = project.repo
    if (!repo || !githubRepoOf(project)) {
      throw new DeliveryError('no_repo', DELIVERY_MESSAGES.noRepo)
    }
    const wt = this.deps.worktree(taskId)
    if (!wt || wt.projectId !== projectId) {
      throw new DeliveryError('no_worktree', DELIVERY_SERVICE_MESSAGES.noWorktree)
    }
    return {
      owner: repo.owner,
      repo: repo.name,
      remote: repo.remoteName,
      branch: wt.branch,
      defaultBranch: repo.defaultBranch,
      displayId: basename(wt.path),
      worktree: wt
    }
  }

  branchUrl(t: DeliveryTarget): string {
    return `https://github.com/${t.owner}/${t.repo}/tree/${t.branch
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
  }

  /**
   * Página "Comparar e criar PR" do GitHub (`<base>...<branch>`), só do repositório do projeto e
   * da branch da tarefa. Sem branch padrão conhecida, o GitHub escolhe a base (`compare/<branch>`).
   */
  compareUrl(projectId: string, taskId: string): string {
    const t = this.target(projectId, taskId)
    const enc = (name: string): string =>
      name
        .split('/')
        // `encodeURIComponent` deixa passar `!'()*~`, que a allowlist do shell não aceita.
        .map((part) =>
          encodeURIComponent(part).replace(
            /[!'()*~]/g,
            (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
          )
        )
        .join('/')
    const range = t.defaultBranch ? `${enc(t.defaultBranch)}...${enc(t.branch)}` : enc(t.branch)
    return `https://github.com/${t.owner}/${t.repo}/compare/${range}?expand=1`
  }

  /** O que o push enviaria (para o gate) e se pode. */
  async preview(projectId: string, taskId: string): Promise<PushPreview> {
    const t = this.target(projectId, taskId)
    const { git } = this.deps
    const dir = t.worktree.path
    // Atualiza a visão da branch remota (sem credencial → segue com o que há localmente).
    await git.fetch(dir, t.remote, t.branch).catch(() => undefined)
    const remoteRef = `${t.remote}/${t.branch}`
    const remoteExists = await git.refExists(dir, remoteRef)
    const base = remoteExists ? remoteRef : t.worktree.baseRef
    const [commits, pending, diff] = await Promise.all([
      git.commitsSince(dir, base).catch(() => []),
      git.statusPorcelain(dir).catch(() => []),
      git.diffStat(dir, `${base}...HEAD`).catch(() => ({ stat: '', files: [] }))
    ])
    const current = await git.currentBranch(dir).catch(() => null)
    const branchProblem = checkPushBranch(t.branch, t) ?? checkPushBranch(current ?? '', t)
    const problem: PushPreview['problem'] = branchProblem
      ? { code: 'branch', message: branchProblem }
      : pending.length > 0
        ? { code: 'dirty', message: DELIVERY_MESSAGES.dirty }
        : commits.length === 0
          ? { code: 'nothing', message: DELIVERY_MESSAGES.nothing }
          : null
    const target: DeliveryTarget = {
      owner: t.owner,
      repo: t.repo,
      remote: t.remote,
      branch: t.branch,
      defaultBranch: t.defaultBranch,
      displayId: t.displayId
    }
    return {
      target,
      commits,
      stat: diff.stat,
      remoteExists,
      pending,
      problem,
      branchUrl: this.branchUrl(t)
    }
  }

  /** A branch da tarefa já está no GitHub com o mesmo conteúdo (nada novo para enviar)? */
  async alreadyPushed(projectId: string, taskId: string): Promise<boolean> {
    const p = await this.preview(projectId, taskId)
    return p.remoteExists && p.commits.length === 0
  }

  /** Faz o push (revalida tudo na hora: o gate pode ter ficado aberto por um tempo). */
  async push(
    projectId: string,
    taskId: string
  ): Promise<{ commits: number; branchUrl: string; target: DeliveryTarget }> {
    const p = await this.preview(projectId, taskId)
    if (p.problem) throw new DeliveryError(p.problem.code, p.problem.message)
    const wt = this.deps.worktree(taskId)!
    try {
      await this.deps.git.push(wt.path, p.target.remote, p.target.branch)
    } catch (error) {
      if (error instanceof GitError) {
        if (error.code === 'credentials') throw new DeliveryError('credentials', error.message)
        if (error.code === 'rejected') throw new DeliveryError('rejected', error.message)
        if (error.code === 'timeout') throw new DeliveryError('git', error.message)
      }
      throw new DeliveryError('git', DELIVERY_SERVICE_MESSAGES.git)
    }
    return { commits: p.commits.length, branchUrl: p.branchUrl, target: p.target }
  }

  /** Commit atual do worktree (para conferir com o `headRefOid` da PR). */
  async head(taskId: string): Promise<string | null> {
    const wt = this.deps.worktree(taskId)
    if (!wt) return null
    return this.deps.git.headCommit(wt.path).catch(() => null)
  }

  /** Contexto do modo entrega lido no começo do passo: aliases e `push.default`. */
  async policyInputs(
    dir: string
  ): Promise<{ gitAliases: Record<string, string>; pushDefault: string | null }> {
    const gitAliases = await this.deps.git.aliases(dir).catch(() => ({}))
    return { gitAliases, pushDefault: await this.deps.git.configValue(dir, 'push.default') }
  }
}

/** Saída de `gh alias list` (`nome: expansão`, uma por linha) → mapa. */
export function parseGhAliases(output: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_.-]+):\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    let value = m[2]!
    if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'")
    else if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"')
    map[m[1]!] = value
  }
  return map
}

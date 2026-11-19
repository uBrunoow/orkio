/**
 * Worktree por tarefa (Etapa 4A): `<userData>/worktrees/<projectId>/<ID>`, na branch da tarefa.
 * Nunca mexe nos arquivos da pasta principal do usuário: `git worktree add` só grava metadados no
 * `.git` do repositório; o código fica na pasta do worktree.
 */
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { mentionsTask, parseDisplayId } from '../../shared/task-id-match'
import { taskBranchName } from '../../shared/slug'
import type { Db } from '../db/database'
import type { Git } from '../git/git'

export type WorktreeGit = Pick<
  Git,
  | 'fetch'
  | 'localBranches'
  | 'remoteBranches'
  | 'refExists'
  | 'worktreeAdd'
  | 'worktreeRemove'
  | 'worktreeList'
  | 'statusPorcelain'
>

export interface WorktreeRecord {
  taskPageId: string
  projectId: string
  path: string
  branch: string
  /** Ref de base (ex.: origin/main) para diff/commits ao terminar. */
  baseRef: string
  createdAt: string
}

export interface WorktreeProject {
  id: string
  localPath: string
  remoteName: string
  defaultBranch: string
}

export interface WorktreeTask {
  id: string
  displayId: string
  title: string
}

export class WorktreeError extends Error {
  constructor(
    readonly code:
      | 'no_task_id'
      | 'branch_checked_out'
      | 'no_base'
      | 'path_in_use'
      | 'dirty'
      | 'git'
      | 'not_found',
    message: string,
    readonly files: string[] = []
  ) {
    super(message)
    this.name = 'WorktreeError'
  }
}

export class WorktreeService {
  constructor(
    private readonly deps: {
      git: WorktreeGit
      db: Db
      /** `<userData>/worktrees` */
      root: string
      now?: () => Date
      exists?: (path: string) => Promise<boolean>
    }
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private async exists(path: string): Promise<boolean> {
    if (this.deps.exists) return this.deps.exists(path)
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  get(taskPageId: string): WorktreeRecord | null {
    const r = this.deps.db.get<{
      task_page_id: string
      project_id: string
      path: string
      branch: string
      base_ref: string
      created_at: string
    }>('SELECT * FROM worktrees WHERE task_page_id = ?', taskPageId)
    return r
      ? {
          taskPageId: r.task_page_id,
          projectId: r.project_id,
          path: r.path,
          branch: r.branch,
          baseRef: r.base_ref,
          createdAt: r.created_at
        }
      : null
  }

  /**
   * Garante o worktree da tarefa. Reutiliza: worktree já registrado → branch local da tarefa →
   * branch remota da tarefa; senão cria `<ID>/<slug>` a partir de `<remote>/<default>` (fetch antes).
   */
  async ensure(
    project: WorktreeProject,
    task: WorktreeTask
  ): Promise<WorktreeRecord & { reused: 'worktree' | 'local_branch' | 'remote_branch' | 'new' }> {
    const parsed = parseDisplayId(task.displayId)
    if (!parsed) {
      throw new WorktreeError(
        'no_task_id',
        'A tarefa não tem ID com prefixo (ex.: ORK-142). Defina um prefixo na propriedade ID do Notion.'
      )
    }
    const { git } = this.deps
    const root = project.localPath
    const registered = this.get(task.id)
    if (registered && (await this.exists(registered.path))) {
      const listed = await git.worktreeList(root).catch(() => [])
      if (listed.some((w) => w.path === registered.path)) {
        return { ...registered, reused: 'worktree' }
      }
    }

    const path = join(this.deps.root, project.id, task.displayId)
    if (await this.exists(path)) {
      throw new WorktreeError(
        'path_in_use',
        `A pasta do ambiente desta tarefa já existe e não é um worktree do projeto. Remova ${task.displayId} da pasta de worktrees do Orkio.`
      )
    }
    await mkdir(join(this.deps.root, project.id), { recursive: true })

    // Base atualizada (sem rede, segue com o que já existe localmente).
    const remote = project.remoteName
    const base = `${remote}/${project.defaultBranch}`
    await git.fetch(root, remote, project.defaultBranch).catch(() => undefined)

    const matches = (name: string): boolean => mentionsTask(name, parsed.prefix, parsed.number)
    const local = (await git.localBranches(root)).find(matches)
    // Branch já aberta em outro worktree (inclusive a pasta principal do usuário): o git recusaria.
    const inUse = local
      ? (await git.worktreeList(root).catch(() => [])).find((w) => w.branch === local)
      : undefined
    if (inUse) {
      throw new WorktreeError(
        'branch_checked_out',
        inUse.path === root
          ? `A branch ${local} está aberta na sua pasta principal. Troque de branch lá (o Orkio não mexe na sua pasta) e tente de novo.`
          : `A branch ${local} já está aberta em outro worktree (${inUse.path}).`
      )
    }
    let reused: 'local_branch' | 'remote_branch' | 'new'
    let branch: string
    try {
      if (local) {
        branch = local
        reused = 'local_branch'
        await git.worktreeAdd(root, path, local, { newBranch: false })
      } else {
        const remoteBranch = (await git.remoteBranches(root, remote)).find(matches)
        if (remoteBranch) {
          branch = remoteBranch
          reused = 'remote_branch'
          await git.worktreeAdd(root, path, remoteBranch, {
            newBranch: false,
            track: `${remote}/${remoteBranch}`
          })
        } else {
          if (!(await git.refExists(root, base))) {
            throw new WorktreeError(
              'no_base',
              `Não encontrei ${base}. Verifique a conexão e o remote do projeto e tente de novo.`
            )
          }
          branch = taskBranchName(task.displayId, task.title)
          reused = 'new'
          await git.worktreeAdd(root, path, branch, { newBranch: true, base })
        }
      }
    } catch (e) {
      if (e instanceof WorktreeError) throw e
      throw new WorktreeError(
        'git',
        'O git não conseguiu criar o ambiente da tarefa. Tente de novo.'
      )
    }

    const record: WorktreeRecord = {
      taskPageId: task.id,
      projectId: project.id,
      path,
      branch,
      baseRef: base,
      createdAt: this.now().toISOString()
    }
    this.deps.db.run(
      `INSERT INTO worktrees (task_page_id, project_id, path, branch, base_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (task_page_id) DO UPDATE SET path = excluded.path, branch = excluded.branch,
         base_ref = excluded.base_ref, created_at = excluded.created_at`,
      record.taskPageId,
      record.projectId,
      record.path,
      record.branch,
      record.baseRef,
      record.createdAt
    )
    return { ...record, reused }
  }

  /**
   * "Limpar ambiente": remove o worktree (a branch fica). Com mudanças não commitadas, recusa a
   * menos que `force` (confirmação explícita do usuário).
   */
  async remove(project: WorktreeProject, taskPageId: string, force: boolean): Promise<void> {
    const record = this.get(taskPageId)
    if (!record) throw new WorktreeError('not_found', 'Esta tarefa não tem ambiente para limpar.')
    if (await this.exists(record.path)) {
      const changes = await this.deps.git.statusPorcelain(record.path)
      if (changes.length > 0 && !force) {
        throw new WorktreeError(
          'dirty',
          `O ambiente tem ${changes.length} mudança(s) não commitada(s). Confirme para descartá-las.`,
          changes.map((l) => l.slice(3))
        )
      }
      try {
        await this.deps.git.worktreeRemove(project.localPath, record.path, force)
      } catch {
        throw new WorktreeError('git', 'O git não conseguiu remover o ambiente. Tente de novo.')
      }
    }
    this.deps.db.run('DELETE FROM worktrees WHERE task_page_id = ?', taskPageId)
  }
}

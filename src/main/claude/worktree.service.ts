/**
 * Worktree por tarefa (Etapa 4A): `<userData>/worktrees/<projectId>/<ID>`, na branch da tarefa.
 * Nunca mexe nos arquivos da pasta principal do usuário: `git worktree add` só grava metadados no
 * `.git` do repositório; o código fica na pasta do worktree.
 */
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { mentionsTask, parseDisplayId } from '../../shared/task-id-match'
import {
  normalizePageId,
  taskBranchName,
  uniqueBranchName,
  type BranchKind
} from '../../shared/slug'
import { parsePorcelainLine } from '../../shared/agent-run'
import { TaskBranchesStore } from '../branches/task-branches.store'
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
  /** ID do Notion (ORK-142); `null` em bancos sem a propriedade de ID. */
  displayId: string | null
  title: string
}

export class WorktreeError extends Error {
  constructor(
    readonly code: 'branch_checked_out' | 'no_base' | 'path_in_use' | 'dirty' | 'git' | 'not_found',
    message: string,
    readonly files: string[] = []
  ) {
    super(message)
    this.name = 'WorktreeError'
  }
}

export class WorktreeService {
  private readonly branches: TaskBranchesStore

  constructor(
    private readonly deps: {
      git: WorktreeGit
      db: Db
      /** `<userData>/worktrees` */
      root: string
      now?: () => Date
      exists?: (path: string) => Promise<boolean>
    }
  ) {
    this.branches = new TaskBranchesStore(deps.db, () => this.now())
  }

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

  /** Branches registradas para a tarefa (criadas pelo Orkio ou vinculadas à mão). */
  linkedBranches(projectId: string, taskId: string): ReturnType<TaskBranchesStore['forTask']> {
    return this.branches.forTask(projectId, taskId)
  }

  linkedBranchesByTask(projectId: string): Map<string, string[]> {
    return this.branches.forProject(projectId)
  }

  /** "Vincular branch": liga uma branch existente à tarefa (troca a tarefa se já era de outra). */
  linkBranch(projectId: string, taskId: string, branch: string): void {
    this.branches.link(projectId, taskId, branch, 'manual')
  }

  unlinkBranch(projectId: string, taskId: string, branch: string): boolean {
    return this.branches.unlink(projectId, taskId, branch)
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
   * branch remota da tarefa; senão cria `<tipo>/<ID>-<slug>` (ou `<tipo>/<slug>` sem ID do Notion) a
   * partir de `<remote>/<default>` (fetch antes). "Da tarefa" = registrada para ela em
   * `task_branches` ou com o ID do Notion no nome. A branch usada fica registrada para a tarefa.
   */
  async ensure(
    project: WorktreeProject,
    task: WorktreeTask,
    options: { kind?: BranchKind } = {}
  ): Promise<WorktreeRecord & { reused: 'worktree' | 'local_branch' | 'remote_branch' | 'new' }> {
    const parsed = parseDisplayId(task.displayId)
    const { git } = this.deps
    const root = project.localPath
    const registered = this.get(task.id)
    if (registered && (await this.exists(registered.path))) {
      const listed = await git.worktreeList(root).catch(() => [])
      if (listed.some((w) => w.path === registered.path)) {
        return { ...registered, reused: 'worktree' }
      }
    }

    // Pasta: o ID do Notion quando há; senão um pedaço do id da página (estável e sem espaços).
    const folder = parsed && task.displayId ? task.displayId : normalizePageId(task.id).slice(0, 12)
    const path = join(this.deps.root, project.id, folder)
    if (await this.exists(path)) {
      throw new WorktreeError(
        'path_in_use',
        `A pasta de trabalho desta tarefa já existe e não é um worktree do projeto. Remova ${folder} da pasta de worktrees do Orkio.`
      )
    }
    await mkdir(join(this.deps.root, project.id), { recursive: true })

    // Base atualizada (sem rede, segue com o que já existe localmente).
    const remote = project.remoteName
    const base = `${remote}/${project.defaultBranch}`
    await git.fetch(root, remote, project.defaultBranch).catch(() => undefined)

    const linked = this.branches.forTask(project.id, task.id).map((l) => l.branch)
    const found = await this.findTaskBranch(project, task)
    const local = found?.where === 'local' ? found.branch : undefined
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
        const remoteBranch = found?.where === 'remote' ? found.branch : undefined
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
          const [localBranches, remoteBranches] = await Promise.all([
            git.localBranches(root),
            git.remoteBranches(root, remote)
          ])
          branch = uniqueBranchName(
            taskBranchName(parsed ? task.displayId : null, task.title, options.kind),
            new Set([...localBranches, ...remoteBranches])
          )
          reused = 'new'
          await git.worktreeAdd(root, path, branch, { newBranch: true, base })
        }
      }
    } catch (e) {
      if (e instanceof WorktreeError) throw e
      throw new WorktreeError(
        'git',
        'O git não conseguiu criar a pasta de trabalho da tarefa. Tente de novo.'
      )
    }
    // A branch usada fica ligada à tarefa (sinais, PR e automações sem o ID no nome).
    if (!linked.includes(branch)) this.branches.link(project.id, task.id, branch, 'orkio')

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
   * Branch que já existe para a tarefa, na ordem de escolha: a registrada para ela
   * (`task_branches`) antes da que tem o ID do Notion no nome, local antes de remota. É a mesma
   * ordem do `ensure` e da exibição antes de rodar. `null` = nenhuma (o `ensure` cria uma).
   */
  async findTaskBranch(
    project: WorktreeProject,
    task: WorktreeTask
  ): Promise<{ branch: string; where: 'local' | 'remote' } | null> {
    const parsed = parseDisplayId(task.displayId)
    const linked = this.branches.forTask(project.id, task.id).map((l) => l.branch)
    if (!parsed && linked.length === 0) return null
    const matches = (name: string): boolean =>
      linked.includes(name) || (!!parsed && mentionsTask(name, parsed.prefix, parsed.number))
    const { git } = this.deps
    const local = await git.localBranches(project.localPath)
    const hit = linked.find((b) => local.includes(b)) ?? local.find(matches)
    if (hit) return { branch: hit, where: 'local' }
    // Os nomes já vêm sem o "<remote>/" (git.remoteBranches).
    const remotes = await git.remoteBranches(project.localPath, project.remoteName)
    const remote = linked.find((b) => remotes.includes(b)) ?? remotes.find(matches)
    return remote ? { branch: remote, where: 'remote' } : null
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
          changes.flatMap((l) => parsePorcelainLine(l)?.path ?? [])
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

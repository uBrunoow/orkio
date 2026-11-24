/**
 * Branches ligadas a cada tarefa (SQLite v10, `task_branches`). Liga branch ↔ tarefa quando o nome
 * da branch não tem o ID do Notion (`feat/listar-pedidos`): o Orkio registra a branch que cria
 * (`orkio`) e a pessoa vincula uma branch existente (`manual`). Uma branch pertence a uma tarefa só
 * por projeto (vincular de novo troca a tarefa). Só nomes de branch e ids; nada de conteúdo.
 */
import type { Db } from '../db/database'

export type TaskBranchSource = 'orkio' | 'manual'

export interface TaskBranchLink {
  branch: string
  taskId: string
  source: TaskBranchSource
  createdAt: string
}

export class TaskBranchesStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date()
  ) {}

  link(projectId: string, taskId: string, branch: string, source: TaskBranchSource): void {
    this.db.run(
      `INSERT INTO task_branches (project_id, branch, task_page_id, source, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, branch) DO UPDATE SET task_page_id = excluded.task_page_id,
         source = excluded.source, created_at = excluded.created_at`,
      projectId,
      branch,
      taskId,
      source,
      this.now().toISOString()
    )
  }

  unlink(projectId: string, taskId: string, branch: string): boolean {
    return (
      this.db.run(
        'DELETE FROM task_branches WHERE project_id = ? AND branch = ? AND task_page_id = ?',
        projectId,
        branch,
        taskId
      ).changes > 0
    )
  }

  forTask(projectId: string, taskId: string): TaskBranchLink[] {
    return this.db
      .all<{ branch: string; task_page_id: string; source: TaskBranchSource; created_at: string }>(
        'SELECT * FROM task_branches WHERE project_id = ? AND task_page_id = ? ORDER BY created_at',
        projectId,
        taskId
      )
      .map((r) => ({
        branch: r.branch,
        taskId: r.task_page_id,
        source: r.source,
        createdAt: r.created_at
      }))
  }

  forProject(projectId: string): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const r of this.db.all<{ branch: string; task_page_id: string }>(
      'SELECT branch, task_page_id FROM task_branches WHERE project_id = ? ORDER BY created_at',
      projectId
    )) {
      const list = out.get(r.task_page_id) ?? []
      list.push(r.branch)
      out.set(r.task_page_id, list)
    }
    return out
  }
}

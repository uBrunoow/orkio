/**
 * Integração com o alva-flow (Etapa 5B) sobre os fluxos da 5A:
 * - vínculo tarefa do Notion ↔ task do Backlog.md (`alva_links`, só ids);
 * - extrator `alva`: depois de cada comando, lê a task no worktree (status, perguntas em aberto,
 *   blocker do review) e, no /spec, detecta a task criada (diferença em backlog/tasks/);
 * - variáveis iniciais (`alva.task_id`, `alva.spec_arg` com o ID e a URL do Notion);
 * - resumo para o painel (id, título, status, critérios) lido do arquivo, nunca guardado.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseBacklogTask,
  sizeFromSpecResult,
  taskFileId,
  type BacklogTaskInfo
} from '../../shared/alva'
import type { Db } from '../db/database'
import type { ExtractContext, ExtractResult, FlowExtractor } from '../flows/flow-runner'

export const ALVA_MESSAGES = {
  noTaskCreated:
    'O /alva-flow:spec terminou sem criar task em backlog/tasks/. Confira o log; retome para tentar de novo.',
  noTaskFile: 'Não achei o arquivo da task vinculada no ambiente da tarefa.',
  choose: 'O /alva-flow:spec criou mais de uma task. Qual é a desta tarefa?'
} as const

export interface AlvaServiceDeps {
  db: Db
  /** Worktree da tarefa (onde o alva-flow grava a task). */
  worktreePath(taskId: string): string | null
  /** Pasta principal do projeto (fallback para ler a task sem worktree). */
  projectDir(projectId: string): string | null
  /** ID, título e URL da tarefa no Notion (para o argumento do primeiro /spec). */
  taskInfo(
    projectId: string,
    taskId: string
  ): Promise<{ displayId: string; title: string; url: string | null } | null>
  now?: () => Date
}

async function listTaskFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(join(dir, 'backlog', 'tasks'))).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

async function readTask(dir: string, file: string): Promise<BacklogTaskInfo | null> {
  try {
    const path = join(dir, 'backlog', 'tasks', file)
    if ((await stat(path)).size > 1024 * 1024) return null
    return parseBacklogTask(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export class AlvaService {
  constructor(private readonly deps: AlvaServiceDeps) {}

  getLink(taskId: string): string | null {
    return (
      this.deps.db.get<{ backlog_task_id: string }>(
        'SELECT backlog_task_id FROM alva_links WHERE task_page_id = ?',
        taskId
      )?.backlog_task_id ?? null
    )
  }

  setLink(projectId: string, taskId: string, backlogId: string): void {
    this.deps.db.run(
      `INSERT INTO alva_links (task_page_id, project_id, backlog_task_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (task_page_id) DO UPDATE SET backlog_task_id = excluded.backlog_task_id`,
      taskId,
      projectId,
      backlogId,
      (this.deps.now?.() ?? new Date()).toISOString()
    )
  }

  /** Lê a task vinculada (worktree primeiro, depois a pasta do projeto). */
  async taskSummary(projectId: string, taskId: string): Promise<BacklogTaskInfo | null> {
    const id = this.getLink(taskId)
    if (!id) return null
    for (const dir of [this.deps.worktreePath(taskId), this.deps.projectDir(projectId)]) {
      if (!dir) continue
      const info = await this.findTask(dir, id)
      if (info) return info
    }
    return null
  }

  private async findTask(dir: string, id: string): Promise<BacklogTaskInfo | null> {
    const files = await listTaskFiles(dir)
    // Pelo nome do arquivo (task-12 - …) e confirmando pelo frontmatter.
    for (const f of files.filter((f) => taskFileId(f) === id.toLowerCase())) {
      const info = await readTask(dir, f)
      if (info && info.id.toLowerCase() === id.toLowerCase()) return info
    }
    return null
  }

  /** Variáveis no início de um fluxo. */
  async initialVars(projectId: string, taskId: string): Promise<Record<string, string>> {
    const linked = this.getLink(taskId)
    if (linked) return { 'alva.task_id': linked, 'alva.spec_arg': linked, 'alva.linked': 'sim' }
    const info = await this.deps.taskInfo(projectId, taskId)
    const parts = info
      ? [
          `${info.displayId} — ${info.title}.`,
          info.url ? `Tarefa no Notion: ${info.url}` : '',
          'Briefing completo em .orkio/briefing.md.'
        ]
      : ['Briefing completo em .orkio/briefing.md.']
    return { 'alva.spec_arg': parts.filter(Boolean).join(' '), 'alva.linked': 'nao' }
  }

  readonly extractor: FlowExtractor = {
    id: 'alva',
    label: 'alva-flow: task do Backlog.md (status, perguntas, blocker)',
    snapshot: async (ctx) => (ctx.worktreePath ? await listTaskFiles(ctx.worktreePath) : []),
    extract: ({ resultText, ctx, snapshot }) => this.extract(ctx, resultText, snapshot),
    resolveChoice: async ({ ctx, value }) => {
      this.setLink(ctx.projectId, ctx.taskId, value)
      return { vars: await this.varsFor(ctx, value, '') }
    }
  }

  private async extract(
    ctx: ExtractContext,
    resultText: string,
    snapshot: unknown
  ): Promise<ExtractResult> {
    const dir = ctx.worktreePath
    if (!dir) return {}
    let id = this.getLink(ctx.taskId)
    if (!id) {
      // Sem vínculo: a task nova é a que apareceu em backlog/tasks/ durante o passo.
      const before = new Set(Array.isArray(snapshot) ? (snapshot as string[]) : [])
      const created: BacklogTaskInfo[] = []
      for (const f of await listTaskFiles(dir)) {
        if (before.has(f)) continue
        const info = await readTask(dir, f)
        if (info) created.push(info)
      }
      if (created.length === 0) {
        return ctx.command.endsWith(':spec') ? { fail: ALVA_MESSAGES.noTaskCreated } : {}
      }
      if (created.length > 1) {
        return {
          vars: this.sizeVars(ctx, resultText, null),
          choose: {
            prompt: ALVA_MESSAGES.choose,
            options: created.map((t) => ({ value: t.id, label: `${t.id} — ${t.title}` }))
          }
        }
      }
      id = created[0]!.id
      this.setLink(ctx.projectId, ctx.taskId, id)
    }
    return { vars: await this.varsFor(ctx, id, resultText) }
  }

  private async varsFor(
    ctx: ExtractContext,
    id: string,
    resultText: string
  ): Promise<Record<string, string>> {
    const info = ctx.worktreePath ? await this.findTask(ctx.worktreePath, id) : null
    const vars: Record<string, string> = { 'alva.task_id': id, 'alva.linked': 'sim' }
    if (!info) return vars
    vars['alva.status'] = info.status
    vars['alva.open_questions'] = String(info.openQuestions)
    if (ctx.command.endsWith(':review')) {
      // O /review deixa Reviewed quando limpo; com Blocker ou suíte vermelha continua Executed.
      vars['alva.review_blocker'] = info.status === 'Reviewed' ? 'nao' : 'sim'
    }
    Object.assign(vars, this.sizeVars(ctx, resultText, info.status))
    return vars
  }

  private sizeVars(
    ctx: ExtractContext,
    resultText: string,
    status: string | null
  ): Record<string, string> {
    if (!ctx.command.endsWith(':spec')) return {}
    if (status === 'Reviewed') return { 'alva.size': 'Pequeno' }
    const size = sizeFromSpecResult(resultText)
    return size ? { 'alva.size': size } : {}
  }
}

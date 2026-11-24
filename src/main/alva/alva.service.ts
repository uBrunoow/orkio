/**
 * Integração com o alva-flow (Etapa 5B) sobre os fluxos da 5A:
 * - vínculo tarefa do Notion ↔ task do Backlog.md (`alva_links`, só ids);
 * - extrator `alva`: depois de cada comando, lê a task no worktree (status, perguntas em aberto,
 *   blocker do review) e, no /spec, detecta a task criada (diferença em backlog/tasks/);
 * - variáveis iniciais (`alva.task_id`, `alva.spec_arg` com o ID e a URL do Notion);
 * - resumo para o painel (id, título, status, critérios) lido do arquivo, nunca guardado.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ALVA_EXTRACTOR,
  ALVA_FAILURES,
  ALVA_REVIEWED,
  ALVA_VARS,
  alvaCommandOf,
  backlogTaskBody,
  parseBacklogTask,
  sizeFromSpecResult,
  taskFileId,
  type BacklogTaskDocument,
  type BacklogTaskInfo
} from '../../shared/alva'
import { FLOW_NO, FLOW_YES } from '../../shared/task-flow'
import { BRIEFING_PATH } from '../../shared/orkio-scratch'
import { redactSecrets } from '../claude/redact'
import type { Db } from '../db/database'
import type { ExtractContext, ExtractResult, FlowExtractor } from '../flows/flow-runner'

export const ALVA_MESSAGES = {
  noTaskCreated:
    'O /alva-flow:spec terminou sem criar nem alterar nenhuma task em backlog/tasks/. Confira o log; retome para tentar de novo.',
  notLinked:
    'Este passo usa a task do Backlog, mas o fluxo ainda não sabe qual é a desta tarefa. Rode o /spec de novo (ou escolha a task) e depois retome.',
  choose: 'O /alva-flow:spec criou mais de uma task. Qual é a desta tarefa?',
  chooseChanged:
    'O /alva-flow:spec atualizou mais de uma task que já existia. Qual é a desta tarefa?'
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
  ): Promise<{ displayId: string | null; title: string; url: string | null } | null>
  now?: () => Date
}

async function listTaskFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(join(dir, 'backlog', 'tasks'))).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

/** Impressão digital de cada task (nome → hash do conteúdo), para ver o que um passo criou ou mudou. */
async function taskSignatures(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of await listTaskFiles(dir)) {
    try {
      const path = join(dir, 'backlog', 'tasks', f)
      const size = (await stat(path)).size
      // Arquivo enorme não é lido: o tamanho já mostra se mudou.
      out[f] =
        size > 1024 * 1024
          ? `size:${size}`
          : createHash('sha1')
              .update(await readFile(path))
              .digest('hex')
    } catch {
      // Sumiu entre a listagem e a leitura: fica de fora.
    }
  }
  return out
}

/**
 * Snapshot de um passo: nome → hash. Formato antigo (só os nomes) ainda é lido: sem hash não dá para
 * saber se uma task mudou, então só as novas contam.
 */
function readSnapshot(snapshot: unknown): Map<string, string | null> {
  if (Array.isArray(snapshot)) {
    return new Map(
      (snapshot as unknown[])
        .filter((v): v is string => typeof v === 'string')
        .map((f) => [f, null])
    )
  }
  if (snapshot !== null && typeof snapshot === 'object') {
    return new Map(
      Object.entries(snapshot as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string'
      )
    )
  }
  return new Map()
}

async function readTaskFile(
  dir: string,
  file: string
): Promise<{ info: BacklogTaskInfo; markdown: string } | null> {
  try {
    const path = join(dir, 'backlog', 'tasks', file)
    if ((await stat(path)).size > 1024 * 1024) return null
    const markdown = await readFile(path, 'utf8')
    const info = parseBacklogTask(markdown)
    return info ? { info, markdown } : null
  } catch {
    return null
  }
}

async function readTask(dir: string, file: string): Promise<BacklogTaskInfo | null> {
  return (await readTaskFile(dir, file))?.info ?? null
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

  /**
   * Task do Backlog.md que o `/spec` desta tarefa está escrevendo, antes do vínculo (o extrator só
   * vincula quando o passo termina, mas o Claude pede a aprovação da spec no meio dele). É a task
   * do worktree que não existe na pasta do projeto ou difere dela; várias → a mais recente.
   */
  private async draftTaskFile(
    projectId: string,
    taskId: string
  ): Promise<{ info: BacklogTaskInfo; markdown: string } | null> {
    const worktree = this.deps.worktreePath(taskId)
    if (!worktree) return null
    // Sem a pasta do projeto não dá para saber o que é desta tarefa: nada de rascunho.
    const project = this.deps.projectDir(projectId)
    if (!project) return null
    const [mine, base] = await Promise.all([taskSignatures(worktree), taskSignatures(project)])
    let best: { file: string; mtime: number } | null = null
    for (const [file, sig] of Object.entries(mine)) {
      if (base[file] === sig) continue
      const mtime = await stat(join(worktree, 'backlog', 'tasks', file))
        .then((s) => s.mtimeMs)
        .catch(() => 0)
      if (!best || mtime > best.mtime) best = { file, mtime }
    }
    return best ? readTaskFile(worktree, best.file) : null
  }

  /**
   * Lê a task vinculada (worktree primeiro, depois a pasta do projeto). Sem vínculo, o rascunho que
   * o `/spec` está escrevendo no worktree (para aprovar vendo a spec).
   */
  async taskSummary(projectId: string, taskId: string): Promise<BacklogTaskInfo | null> {
    const id = this.getLink(taskId)
    if (!id) return (await this.draftTaskFile(projectId, taskId))?.info ?? null
    for (const dir of [this.deps.worktreePath(taskId), this.deps.projectDir(projectId)]) {
      if (!dir) continue
      const info = await this.findTask(dir, id)
      if (info) return info
    }
    return null
  }

  /**
   * A task vinculada para leitura na tela (spec, critérios, plano): o texto sai sem frontmatter e
   * sem marcadores, com segredos ocultados e cortado no limite. Nada disso é guardado.
   */
  async taskDocument(projectId: string, taskId: string): Promise<BacklogTaskDocument | null> {
    const id = this.getLink(taskId)
    if (!id) {
      const draft = await this.draftTaskFile(projectId, taskId)
      if (!draft) return null
      const { body, truncated } = backlogTaskBody(draft.markdown)
      return { info: draft.info, body: redactSecrets(body), truncated, draft: true }
    }
    for (const dir of [this.deps.worktreePath(taskId), this.deps.projectDir(projectId)]) {
      if (!dir) continue
      const found = await this.findTaskFile(dir, id)
      if (!found) continue
      const { body, truncated } = backlogTaskBody(found.markdown)
      return { info: found.info, body: redactSecrets(body), truncated }
    }
    return null
  }

  private async findTaskFile(
    dir: string,
    id: string
  ): Promise<{ info: BacklogTaskInfo; markdown: string } | null> {
    const files = await listTaskFiles(dir)
    // Pelo nome do arquivo (task-12 - …) e confirmando pelo frontmatter.
    for (const f of files.filter((f) => taskFileId(f) === id.toLowerCase())) {
      const found = await readTaskFile(dir, f)
      if (found && found.info.id.toLowerCase() === id.toLowerCase()) return found
    }
    return null
  }

  private async findTask(dir: string, id: string): Promise<BacklogTaskInfo | null> {
    return (await this.findTaskFile(dir, id))?.info ?? null
  }

  /** Variáveis no início de um fluxo. */
  async initialVars(projectId: string, taskId: string): Promise<Record<string, string>> {
    const linked = this.getLink(taskId)
    if (linked) return linkedVars(linked)
    const info = await this.deps.taskInfo(projectId, taskId)
    const parts = info
      ? [
          info.displayId ? `${info.displayId} — ${info.title}.` : `${info.title}.`,
          info.url ? `Tarefa no Notion: ${info.url}` : '',
          `Briefing completo em ${BRIEFING_PATH}.`
        ]
      : [`Briefing completo em ${BRIEFING_PATH}.`]
    return { [ALVA_VARS.specArg]: parts.filter(Boolean).join(' '), [ALVA_VARS.linked]: FLOW_NO }
  }

  readonly extractor: FlowExtractor = {
    id: ALVA_EXTRACTOR,
    label: 'alva-flow: task do Backlog.md (status, perguntas, blocker)',
    // Antes do passo. Na primeira rodada da tarefa o worktree ainda não existe (o passo o cria a
    // partir da branch padrão): a foto vem da pasta do projeto. Foto vazia faria todas as tasks
    // do repositório parecerem "criadas pelo /spec".
    snapshot: async (ctx) => {
      if (ctx.worktreePath && existsSync(join(ctx.worktreePath, 'backlog'))) {
        return taskSignatures(ctx.worktreePath)
      }
      const project = this.deps.projectDir(ctx.projectId)
      return project ? taskSignatures(project) : {}
    },
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
      // Sem vínculo: a task desta tarefa é a que o passo criou em backlog/tasks/. Se não criou
      // nenhuma, mas atualizou uma que já existia (de outra rodada, de outra pessoa), é essa: o
      // /spec retoma a task em vez de criar outra.
      const before = readSnapshot(snapshot)
      const now = await taskSignatures(dir)
      const createdFiles = Object.keys(now).filter((f) => !before.has(f))
      const changedFiles = Object.keys(now).filter((f) => {
        const old = before.get(f)
        return old !== undefined && old !== null && old !== now[f]
      })
      const read = async (files: string[]): Promise<BacklogTaskInfo[]> =>
        (await Promise.all(files.map((f) => readTask(dir, f)))).filter(
          (t): t is BacklogTaskInfo => t !== null
        )
      const created = await read(createdFiles)
      const candidates = created.length > 0 ? created : await read(changedFiles)
      if (candidates.length === 0) {
        return alvaCommandOf(ctx.step.command) === 'spec'
          ? { fail: { code: ALVA_FAILURES.noTaskCreated, message: ALVA_MESSAGES.noTaskCreated } }
          : {}
      }
      if (candidates.length > 1) {
        return {
          vars: this.sizeVars(ctx, resultText, null),
          choose: {
            prompt: created.length > 0 ? ALVA_MESSAGES.choose : ALVA_MESSAGES.chooseChanged,
            options: candidates.map((t) => ({ value: t.id, label: `${t.id} — ${t.title}` }))
          }
        }
      }
      id = candidates[0]!.id
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
    // Com vínculo, um novo /spec recebe o ID (retoma a task em vez de criar outra).
    const vars = linkedVars(id)
    if (!info) return vars
    vars[ALVA_VARS.status] = info.status
    vars[ALVA_VARS.openQuestions] = String(info.openQuestions)
    if (alvaCommandOf(ctx.step.command) === 'review') {
      // O /review deixa Reviewed quando limpo; com Blocker ou suíte vermelha continua Executed.
      vars[ALVA_VARS.reviewBlocker] = info.status === ALVA_REVIEWED ? FLOW_NO : FLOW_YES
    }
    Object.assign(vars, this.sizeVars(ctx, resultText, info.status))
    return vars
  }

  private sizeVars(
    ctx: ExtractContext,
    resultText: string,
    status: string | null
  ): Record<string, string> {
    if (alvaCommandOf(ctx.step.command) !== 'spec') return {}
    if (status === ALVA_REVIEWED) return { [ALVA_VARS.size]: 'Pequeno' }
    const size = sizeFromSpecResult(resultText)
    return size ? { [ALVA_VARS.size]: size } : {}
  }
}

/** Variáveis de uma tarefa já vinculada: um novo /spec recebe o ID (retoma a task). */
function linkedVars(id: string): Record<string, string> {
  return { [ALVA_VARS.taskId]: id, [ALVA_VARS.specArg]: id, [ALVA_VARS.linked]: FLOW_YES }
}

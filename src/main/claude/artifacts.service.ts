/**
 * Artefatos das tarefas (Etapa 4B): documentos gerados no worktree que o usuário anexa à tarefa e,
 * se quiser, publica no Notion.
 *
 * - Anexar guarda só caminho + commit (SQLite `task_artifacts`); o conteúdo continua no git.
 * - Publicar lê o arquivo NAQUELE commit (não o rascunho), redige segredos e envia ao Notion como
 *   seção no fim da página da tarefa ou como subpágina. Precisa da capacidade "Insert content".
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  isDocFile,
  type ArtifactCandidate,
  type ArtifactPublishMode,
  type ArtifactView
} from '../../shared/agent-run'
import type { BoardStore } from '../board/board.store'
import type { Db } from '../db/database'
import type { Git } from '../git/git'
import { redactSecrets } from './redact'
import type { WorktreeService } from './worktree.service'

/** Acima disso o Notion tende a recusar (5.000 blocos / 500 KB por requisição). */
export const MAX_PUBLISH_CHARS = 150_000

export const ARTIFACT_MESSAGES = {
  noWorkspace: 'Esta tarefa não tem ambiente. Rode o Claude Code primeiro.',
  notCandidate: 'Esse arquivo não é um documento alterado nesta tarefa.',
  uncommitted: 'O documento tem mudanças não commitadas. Faça commit antes de anexar.',
  notFound: 'Artefato não encontrado. Atualize a tela.',
  tooBig: 'Documento grande demais para publicar no Notion (limite de 150 mil caracteres).',
  missing: 'O commit do artefato não existe mais no repositório (branch apagada?).'
} as const

export class ArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ArtifactError'
  }
}

export interface ArtifactsDeps {
  db: Db
  store: BoardStore
  worktrees: Pick<WorktreeService, 'get'>
  git: Pick<Git, 'diffStat' | 'statusPorcelain' | 'headCommit' | 'fileAtCommit'>
  notion: {
    createChildPage(
      parentPageId: string,
      title: string,
      markdown: string
    ): Promise<{ id: string; url: string | null }>
    appendMarkdown(pageId: string, markdown: string): Promise<void>
  }
  now?: () => Date
  newId?: () => string
}

interface Row {
  id: string
  task_page_id: string
  project_id: string
  run_id: string | null
  path: string
  commit_hash: string
  attached_at: string
  notion_page_id: string | null
  notion_mode: ArtifactPublishMode | null
  published_at: string | null
}

export class ArtifactsService {
  constructor(private readonly deps: ArtifactsDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  /** Documentos alterados desde a base no worktree da tarefa. */
  async candidates(taskId: string): Promise<ArtifactCandidate[]> {
    const wt = this.deps.worktrees.get(taskId)
    if (!wt) throw new ArtifactError('no_workspace', ARTIFACT_MESSAGES.noWorkspace)
    const { files } = await this.deps.git.diffStat(wt.path, wt.baseRef)
    // Pastas novas aparecem agrupadas (`?? docs/`): tudo dentro delas está pendente.
    const pending = (await this.deps.git.statusPorcelain(wt.path)).map((l) => unquote(l.slice(3)))
    const isPending = (path: string): boolean =>
      pending.some((p) => p === path || (p.endsWith('/') && path.startsWith(p)))
    return files.filter(isDocFile).map((path) => ({ path, committed: !isPending(path) }))
  }

  list(taskId: string): ArtifactView[] {
    return this.deps.db
      .all<Row>(
        'SELECT * FROM task_artifacts WHERE task_page_id = ? ORDER BY attached_at DESC',
        taskId
      )
      .map(toView)
  }

  /** Anexa o documento no commit atual do worktree (precisa estar commitado). */
  async attach(
    projectId: string,
    taskId: string,
    path: string,
    runId: string | null
  ): Promise<ArtifactView> {
    const wt = this.deps.worktrees.get(taskId)
    if (!wt) throw new ArtifactError('no_workspace', ARTIFACT_MESSAGES.noWorkspace)
    const candidate = (await this.candidates(taskId)).find((c) => c.path === path)
    if (!candidate) throw new ArtifactError('not_candidate', ARTIFACT_MESSAGES.notCandidate)
    if (!candidate.committed) throw new ArtifactError('uncommitted', ARTIFACT_MESSAGES.uncommitted)
    const commit = (await this.deps.git.headCommit(wt.path)).trim()

    const existing = this.deps.db.get<Row>(
      'SELECT * FROM task_artifacts WHERE task_page_id = ? AND path = ? AND commit_hash = ?',
      taskId,
      path,
      commit
    )
    if (existing) return toView(existing)

    const id = this.deps.newId?.() ?? randomUUID()
    const at = this.now()
    this.deps.store.transaction(() => {
      this.deps.db.run(
        `INSERT INTO task_artifacts (id, task_page_id, project_id, run_id, path, commit_hash, attached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        taskId,
        projectId,
        runId,
        path,
        commit,
        at
      )
      this.event(taskId, projectId, 'artifact_attached', { path, commit: commit.slice(0, 12) })
    })
    return toView(this.row(id))
  }

  /**
   * Publica no Notion o conteúdo do arquivo no commit anexado. `root` = pasta principal do
   * repositório (o commit continua lá mesmo depois de limpar o worktree).
   */
  async publish(
    artifactId: string,
    mode: ArtifactPublishMode,
    root: string
  ): Promise<{ artifact: ArtifactView; url: string | null }> {
    const row = this.row(artifactId)
    let content: string
    try {
      content = await this.deps.git.fileAtCommit(root, row.commit_hash, row.path)
    } catch {
      throw new ArtifactError('missing', ARTIFACT_MESSAGES.missing)
    }
    if (content.length > MAX_PUBLISH_CHARS) {
      throw new ArtifactError('too_big', ARTIFACT_MESSAGES.tooBig)
    }
    const clean = redactSecrets(content).trim()
    const short = row.commit_hash.slice(0, 7)
    const file = basename(row.path)

    let pageId: string | null = null
    let url: string | null = null
    if (mode === 'child_page') {
      const title = /^#\s+(.+)$/m.exec(clean)?.[1]?.trim() || file
      const body = `${clean}\n\n---\n\n_Publicado pelo Orkio de \`${row.path}\` (commit ${short})._`
      const created = await this.deps.notion.createChildPage(row.task_page_id, title, body)
      pageId = created.id
      url = created.url
    } else {
      // Títulos do documento descem um nível para ficarem dentro da seção.
      const nested = clean.replace(/^(#{1,5})\s/gm, '#$1 ')
      const section = `## ${file}\n\n_Do Orkio: \`${row.path}\` (commit ${short})._\n\n${nested}`
      await this.deps.notion.appendMarkdown(row.task_page_id, section)
    }

    const at = this.now()
    this.deps.store.transaction(() => {
      this.deps.db.run(
        'UPDATE task_artifacts SET notion_page_id = ?, notion_mode = ?, published_at = ? WHERE id = ?',
        pageId,
        mode,
        at,
        artifactId
      )
      this.event(row.task_page_id, row.project_id, 'artifact_published', {
        path: row.path,
        mode
      })
    })
    return { artifact: toView(this.row(artifactId)), url }
  }

  private row(id: string): Row {
    const row = this.deps.db.get<Row>('SELECT * FROM task_artifacts WHERE id = ?', id)
    if (!row) throw new ArtifactError('not_found', ARTIFACT_MESSAGES.notFound)
    return row
  }

  private event(
    taskId: string,
    projectId: string,
    kind: 'artifact_attached' | 'artifact_published',
    detail: Record<string, unknown>
  ): void {
    this.deps.store.addEvent({
      taskPageId: taskId,
      projectId,
      at: this.now(),
      kind,
      source: 'manual',
      fromStage: null,
      toStage: null,
      detail
    })
  }
}

function toView(r: Row): ArtifactView {
  return {
    id: r.id,
    path: r.path,
    commit: r.commit_hash,
    runId: r.run_id,
    attachedAt: r.attached_at,
    notion:
      r.notion_mode && r.published_at
        ? { mode: r.notion_mode, pageId: r.notion_page_id, publishedAt: r.published_at }
        : null
  }
}

/** `git status --porcelain` põe aspas em caminhos com espaços. */
function unquote(path: string): string {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
}

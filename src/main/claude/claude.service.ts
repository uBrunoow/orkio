/**
 * Fachada do Claude Code (Etapa 4A) para o IPC: detecção, preparo (briefing do Notion + branch),
 * execução, permissões, ambiente (worktree), editor e diff.
 *
 * O renderer só manda ids (projeto, tarefa, execução); caminhos e nomes de branch são resolvidos
 * aqui. Conteúdo das páginas do Notion fica só em memória (briefing) e no log da execução.
 */
import type { DeliveryTarget } from '../../shared/delivery'
import { CONTEXT_LIMITS } from '../../shared/agent-run'
import type {
  ProjectClaudeContext,
  ArtifactCandidate,
  ArtifactPublishMode,
  ArtifactView,
  CatalogGroup,
  ClaudeCodeStatus,
  ClaudeResult,
  EditorId,
  PermissionAnswer,
  RunLogEvent,
  RunPreparation,
  StartRunRequest,
  TaskRunsState,
  TaskWorkspace
} from '../../shared/agent-run'
import {
  blocksToMarkdown,
  buildBriefing,
  buildProjectContext,
  type NotionBlock
} from '../../shared/briefing'
import type { NotionResult, NotionTask, TaskSignalsResult } from '../../shared/ipc-contract'
import { taskBranchName } from '../../shared/slug'
import { mentionsTask, parseDisplayId } from '../../shared/task-id-match'
import type { OrkioConfig, StoredProject } from '../config/orkio-config'
import type { Git } from '../git/git'
import { errorName } from '../ipc/payload'
import { NotionApiError } from '../connectors/notion/notion.client'
import { ArtifactError, type ArtifactsService } from './artifacts.service'
import { buildCatalog } from './catalog'
import { RUN_MESSAGES, type RunAgent, type RunService } from './run.service'
import { WorktreeError, type WorktreeProject, type WorktreeService } from './worktree.service'

export const CLAUDE_MESSAGES = {
  projectNotFound: 'Projeto não encontrado. Atualize a lista de projetos.',
  noRepo: 'Este projeto não tem repositório do GitHub detectado.',
  taskNotFound: 'Tarefa não encontrada no Notion. Atualize o quadro.',
  noTaskId: 'A tarefa não tem ID com prefixo (ex.: ORK-142). Defina um prefixo no Notion.',
  notInstalled: 'Claude Code não encontrado. Instale o CLI e faça login para rodar tarefas.',
  notLoggedIn: 'O Claude Code não está logado. Rode `claude` no terminal e faça login.',
  tooOld: 'Atualize o Claude Code para rodar tarefas pelo Orkio.',
  noWorkspace: 'Esta tarefa ainda não tem ambiente. Rode o Claude Code primeiro.',
  editor: 'Não foi possível abrir o editor. Confira se o comando está instalado no PATH.',
  invalidCommand: 'Nome de comando inválido.',
  emptyPrompt: 'Escreva o que o Claude Code deve fazer.',
  flowActive:
    'Esta tarefa tem um fluxo em andamento. Use o fluxo (ou cancele-o) para rodar o Claude Code.',
  pageUnavailable: 'Não deu para ler a página da tarefa no Notion; o briefing usa só os campos.',
  generic: 'Algo deu errado. Tente novamente.'
} as const

/** Limites da leitura da página: profundidade e total de blocos. */
const MAX_DEPTH = 3
const MAX_BLOCKS = 400
const MAX_DIFF_CHARS = 400_000
const COMMAND_NAME = /^[A-Za-z0-9][\w:.-]{0,80}$/

export interface ClaudeServiceDeps {
  /**
   * Modo entrega (5C): alvo da entrega (repositório + branch da tarefa) e o ajuste do projeto.
   * Lança erro com mensagem pt-BR se não houver repositório verificado/ambiente.
   */
  deliveryTarget?(
    projectId: string,
    taskId: string
  ): { target: DeliveryTarget; requirePushApproval: boolean }
  config: {
    get(): OrkioConfig
    update(fn: (c: OrkioConfig) => OrkioConfig): Promise<unknown>
  }
  /** Busca páginas no Notion (contexto do projeto). */
  searchPages(query: string): Promise<{ results: unknown[]; nextCursor: string | null }>
  worktrees: WorktreeService
  runs: RunService
  git: Pick<Git, 'statusPorcelain' | 'diffText' | 'localBranches' | 'remoteBranches'>
  listTasks(projectId: string): Promise<NotionResult<{ tasks: NotionTask[] }>>
  signals(projectId: string): Promise<NotionResult<TaskSignalsResult>>
  /** Leitura dos blocos de uma página (o token fica no conector). */
  getBlockChildren(
    id: string,
    cursor: string | null
  ): Promise<{ results: unknown[]; nextCursor: string | null }>
  detect(): Promise<ClaudeCodeStatus>
  artifacts: ArtifactsService
  /** 5A: a tarefa tem fluxo ativo? (bloqueia a execução manual). */
  flowActive?: (taskId: string) => boolean
  /** Abre a pasta no editor (execFile, sem shell). */
  openEditor(editor: EditorId, path: string): Promise<void>
  /**
   * 8A: agente da tarefa para o "Rodar" manual. `null` = sem agente. Lança `Error` com mensagem
   * pt-BR quando há agente, mas ele não pode rodar (sem aprovação, limite do dia, comando negado).
   */
  agentFor?: (projectId: string, taskId: string, command: string | null) => Promise<RunAgent | null>
  /** 8A: o que o formulário mostra ("Rodar como Ana" ou por que não dá). */
  agentInfo?: (
    projectId: string,
    taskId: string
  ) => Promise<{ name: string; problem: string | null } | null>
}

export class ClaudeService {
  private status: ClaudeCodeStatus | null = null
  private commands: string[] = []

  constructor(private readonly deps: ClaudeServiceDeps) {}

  async getStatus(force = false): Promise<ClaudeCodeStatus> {
    if (!this.status || force) this.status = await this.deps.detect()
    return this.status
  }

  /** Chamado a cada evento das execuções: guarda os comandos vistos no `init`. */
  onRunEvent(event: RunLogEvent): void {
    if (event.kind === 'init' && event.commands.length > 0) this.commands = [...event.commands]
  }

  state(projectId: string, taskId: string): Promise<ClaudeResult<TaskRunsState>> {
    return this.wrap(async () => {
      this.project(projectId)
      return ok(await this.taskState(taskId))
    })
  }

  prepare(projectId: string, taskId: string): Promise<ClaudeResult<RunPreparation>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const task = await this.task(projectId, taskId)
      const parsed = task.displayId ? parseDisplayId(task.displayId) : null
      if (!task.displayId || !parsed) return fail('no_task_id', CLAUDE_MESSAGES.noTaskId)

      const state = await this.taskState(taskId)
      const branch =
        state.workspace?.branch ??
        (await this.existingBranch(project, task.displayId)) ??
        taskBranchName(task.displayId, task.title)

      let pageMarkdown = ''
      let unsupported: string[] = []
      let pageWarning: string | null = null
      try {
        const blocks = await this.pageBlocks(task.id)
        const md = blocksToMarkdown(blocks)
        pageMarkdown = md.markdown
        unsupported = md.unsupported
      } catch (error) {
        console.error(`[orkio] briefing: página indisponível: ${errorName(error)}`)
        pageWarning = CLAUDE_MESSAGES.pageUnavailable
      }

      let pr: { number: number; state: string; url: string } | null = null
      const signals = await this.deps.signals(projectId).catch(() => null)
      if (signals?.ok) {
        const p = signals.value.signals[taskId]?.pr
        if (p) pr = { number: p.number, state: p.state, url: p.url }
      }

      const properties = [
        { name: 'Status', value: task.status?.name ?? '' },
        { name: 'Prioridade', value: task.priority?.name ?? '' },
        { name: 'Responsáveis', value: task.assignees.join(', ') }
      ]
      const context = await this.projectContext(projectId)
      const briefing = buildBriefing({
        displayId: task.displayId,
        title: task.title,
        url: task.url,
        properties,
        pageMarkdown: pageWarning ? `> ${pageWarning}` : pageMarkdown,
        unsupported,
        project: {
          name: project.name,
          repo: project.repo ? `${project.repo.owner}/${project.repo.name}` : null,
          branch,
          worktree: state.workspace?.path ?? '(será criado ao rodar)'
        },
        pr,
        ...(context.markdown ? { projectContext: context.markdown } : {})
      })
      const agent = (await this.deps.agentInfo?.(projectId, taskId).catch(() => null)) ?? null
      return ok({
        ...state,
        agent,
        taskId,
        displayId: task.displayId,
        title: task.title,
        briefing,
        unsupported: [...new Set(unsupported)],
        branch,
        commands: this.commands,
        contextWarnings: context.warnings
      })
    })
  }

  start(req: StartRunRequest): Promise<ClaudeResult<TaskRunsState>> {
    return this.wrap(async () => {
      // 5A: com fluxo ativo, quem roda o Claude Code na tarefa é o fluxo.
      if (this.deps.flowActive?.(req.taskId)) return fail('flow_active', CLAUDE_MESSAGES.flowActive)
      let agent: RunAgent | null = null
      if (req.asAgent !== false && this.deps.agentFor) {
        try {
          agent = await this.deps.agentFor(
            req.projectId,
            req.taskId,
            req.mode === 'command' ? req.command : null
          )
        } catch (error) {
          return fail('agent', error instanceof Error ? error.message : 'Agente indisponível.')
        }
      }
      const started = await this.startRun(req, undefined, true, false, agent)
      if (!started.ok) return started
      return ok(await this.taskState(req.taskId))
    })
  }

  /** Passo `claude_command` de um fluxo (5A): mesma execução da 4A; devolve o id ou o erro. */
  startForFlow(input: {
    projectId: string
    taskId: string
    command: string
    args: string
    briefing: string
    timeoutMin: number
    includeBriefing?: boolean
    /** Modo entrega (5C): só nesta execução. */
    delivery?: boolean
    /** Agente (8A) do fluxo (cópia do perfil feita no início do fluxo). */
    agent?: RunAgent | null
  }): Promise<ClaudeResult<string>> {
    return this.wrap(() =>
      this.startRun(
        {
          projectId: input.projectId,
          taskId: input.taskId,
          mode: 'command',
          command: input.command,
          text: input.args,
          briefing: input.briefing
        },
        input.timeoutMin,
        input.includeBriefing !== false,
        input.delivery === true,
        input.agent ?? null
      )
    )
  }

  /** Contexto de um fluxo (5A): briefing do Notion, ID e URL da tarefa. */
  flowContext(
    projectId: string,
    taskId: string
  ): Promise<
    ClaudeResult<{ briefing: string; displayId: string; title: string; notionUrl: string | null }>
  > {
    return this.wrap(async () => {
      const prep = await this.prepare(projectId, taskId)
      if (!prep.ok) return prep
      const task = await this.task(projectId, taskId)
      return ok({
        briefing: prep.value.briefing,
        displayId: prep.value.displayId,
        title: task.title,
        notionUrl: task.url
      })
    })
  }

  private async startRun(
    req: StartRunRequest,
    timeoutMin?: number,
    includeBriefing = true,
    delivery = false,
    agent: RunAgent | null = null
  ): Promise<ClaudeResult<string>> {
    const project = this.project(req.projectId)
    const status = await this.getStatus(true)
    if (!status.installed) return fail('not_installed', CLAUDE_MESSAGES.notInstalled)
    if (status.loggedIn === false) return fail('not_logged_in', CLAUDE_MESSAGES.notLoggedIn)
    if (!status.meetsMinimum) return fail('too_old', CLAUDE_MESSAGES.tooOld)
    if (req.mode === 'command' && !(req.command && COMMAND_NAME.test(req.command))) {
      return fail('invalid', CLAUDE_MESSAGES.invalidCommand)
    }
    if (req.mode === 'prompt' && !req.text.trim()) {
      return fail('invalid', CLAUDE_MESSAGES.emptyPrompt)
    }
    const task = await this.task(req.projectId, req.taskId)
    if (!task.displayId) return fail('no_task_id', CLAUDE_MESSAGES.noTaskId)
    const wtProject = this.worktreeProject(project)
    const taskRef = { id: task.id, displayId: task.displayId, title: task.title }
    await this.deps.worktrees.ensure(wtProject, taskRef)
    let deliveryInput: { target: DeliveryTarget; requirePushApproval: boolean } | null = null
    if (delivery) {
      if (!this.deps.deliveryTarget) return fail('no_repo', CLAUDE_MESSAGES.noRepo)
      try {
        deliveryInput = this.deps.deliveryTarget(req.projectId, req.taskId)
      } catch (error) {
        return fail('no_repo', error instanceof Error ? error.message : CLAUDE_MESSAGES.noRepo)
      }
    }
    const view = await this.deps.runs.start({
      project: { ...wtProject, name: project.name },
      task: taskRef,
      mode: req.mode,
      command: req.mode === 'command' ? req.command : null,
      text: req.text,
      briefing: req.briefing,
      ...(timeoutMin ? { timeoutMin } : {}),
      includeBriefing,
      delivery: deliveryInput,
      agent
    })
    return ok(view.id)
  }

  cancel(runId: string): void {
    try {
      this.deps.runs.cancel(runId)
    } catch {
      // Já terminou: nada a cancelar.
    }
  }

  answerPermission(runId: string, requestId: string, answer: PermissionAnswer): void {
    this.deps.runs.answerPermission(runId, requestId, answer)
  }

  answerQuestion(runId: string, requestId: string, answers: Record<string, string>): void {
    this.deps.runs.answerQuestion(runId, requestId, answers)
  }

  async readLog(runId: string): Promise<RunLogEvent[]> {
    return this.deps.runs.readLog(runId)
  }

  /** "Limpar ambiente": remove o worktree (a branch fica). Mudanças pendentes pedem `force`. */
  cleanup(projectId: string, taskId: string, force: boolean): Promise<ClaudeResult<TaskRunsState>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      if (this.deps.runs.isRunning(taskId)) {
        return fail('busy', 'Cancele a execução em andamento antes de limpar o ambiente.')
      }
      await this.deps.worktrees.remove(this.worktreeProject(project), taskId, force)
      return ok(await this.taskState(taskId))
    })
  }

  openEditor(projectId: string, taskId: string, editor: EditorId): Promise<ClaudeResult<null>> {
    return this.wrap(async () => {
      this.project(projectId)
      const wt = this.deps.worktrees.get(taskId)
      if (!wt) return fail('no_workspace', CLAUDE_MESSAGES.noWorkspace)
      try {
        await this.deps.openEditor(editor, wt.path)
      } catch (error) {
        console.error(`[orkio] editor: ${errorName(error)}`)
        return fail('editor', CLAUDE_MESSAGES.editor)
      }
      return ok(null)
    })
  }

  /** Contexto do projeto (instruções + páginas de referência; só ids e nomes). */
  getContext(projectId: string): Promise<ClaudeResult<ProjectClaudeContext>> {
    return this.wrap(async () => {
      this.project(projectId)
      return ok(
        this.deps.config.get().claudeContexts[projectId] ?? { instructions: '', notionPages: [] }
      )
    })
  }

  saveContext(
    projectId: string,
    context: ProjectClaudeContext
  ): Promise<ClaudeResult<ProjectClaudeContext>> {
    return this.wrap(async () => {
      this.project(projectId)
      if (context.instructions.length > CONTEXT_LIMITS.instructions) {
        return fail(
          'invalid',
          `As instruções passam de ${CONTEXT_LIMITS.instructions.toLocaleString('pt-BR')} caracteres.`
        )
      }
      if (context.notionPages.length > CONTEXT_LIMITS.pages) {
        return fail('invalid', `Escolha no máximo ${CONTEXT_LIMITS.pages} páginas de referência.`)
      }
      const clean: ProjectClaudeContext = {
        instructions: context.instructions,
        notionPages: context.notionPages.map((p) => ({ id: p.id, name: p.name.slice(0, 200) }))
      }
      await this.deps.config.update((c) => ({
        ...c,
        claudeContexts: { ...c.claudeContexts, [projectId]: clean }
      }))
      return ok(clean)
    })
  }

  /** Páginas do Notion por título (para escolher referências). */
  searchPages(query: string): Promise<ClaudeResult<{ id: string; name: string }[]>> {
    return this.wrap(async () => {
      const page = await this.deps.searchPages(query.slice(0, 200))
      return ok(page.results.flatMap((r) => pageRef(r)))
    })
  }

  /** Documentos candidatos (alterados no worktree) e artefatos já anexados. */
  artifacts(
    projectId: string,
    taskId: string
  ): Promise<ClaudeResult<{ candidates: ArtifactCandidate[]; attached: ArtifactView[] }>> {
    return this.wrap(async () => {
      this.project(projectId)
      const attached = this.deps.artifacts.list(taskId)
      const candidates = this.deps.worktrees.get(taskId)
        ? await this.deps.artifacts.candidates(taskId)
        : []
      return ok({ candidates, attached })
    })
  }

  attachArtifact(
    projectId: string,
    taskId: string,
    path: string,
    runId: string | null
  ): Promise<ClaudeResult<ArtifactView>> {
    return this.wrap(async () => {
      this.project(projectId)
      return ok(await this.deps.artifacts.attach(projectId, taskId, path, runId))
    })
  }

  /** Publica no Notion (seção na página da tarefa ou subpágina). Precisa de "Insert content". */
  publishArtifact(
    projectId: string,
    artifactId: string,
    mode: ArtifactPublishMode
  ): Promise<ClaudeResult<{ artifact: ArtifactView; url: string | null }>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      return ok(await this.deps.artifacts.publish(artifactId, mode, project.localPath))
    })
  }

  /** Catálogo de comandos; usa a pasta do worktree da tarefa (ou do projeto) para os do projeto. */
  catalog(projectId: string, taskId: string): Promise<ClaudeResult<CatalogGroup[]>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const dir = this.deps.worktrees.get(taskId)?.path ?? project.localPath
      return ok(await buildCatalog({ projectDir: dir }))
    })
  }

  diff(
    projectId: string,
    taskId: string
  ): Promise<ClaudeResult<{ diff: string; truncated: boolean; untracked: string[] }>> {
    return this.wrap(async () => {
      this.project(projectId)
      const wt = this.deps.worktrees.get(taskId)
      if (!wt) return fail('no_workspace', CLAUDE_MESSAGES.noWorkspace)
      const text = await this.deps.git.diffText(wt.path, wt.baseRef)
      const untracked = (await this.deps.git.statusPorcelain(wt.path))
        .filter((l) => l.startsWith('??'))
        .map((l) => l.slice(3))
      return ok({
        diff: text.slice(0, MAX_DIFF_CHARS),
        truncated: text.length > MAX_DIFF_CHARS,
        untracked
      })
    })
  }

  // ---------- Interno ----------

  private project(projectId: string): StoredProject & { repo: NonNullable<StoredProject['repo']> } {
    const project = this.deps.config.get().projects.find((p) => p.id === projectId)
    if (!project) throw new ClaudeFailure('not_found', CLAUDE_MESSAGES.projectNotFound)
    if (!project.repo) throw new ClaudeFailure('no_repo', CLAUDE_MESSAGES.noRepo)
    return project as StoredProject & { repo: NonNullable<StoredProject['repo']> }
  }

  private worktreeProject(
    project: StoredProject & { repo: NonNullable<StoredProject['repo']> }
  ): WorktreeProject {
    return {
      id: project.id,
      localPath: project.localPath,
      remoteName: project.repo.remoteName,
      defaultBranch: project.repo.defaultBranch ?? 'main'
    }
  }

  private async task(projectId: string, taskId: string): Promise<NotionTask> {
    const result = await this.deps.listTasks(projectId)
    if (!result.ok) throw new ClaudeFailure(result.error.code, result.error.message)
    const task = result.value.tasks.find((t) => t.id === taskId)
    if (!task) throw new ClaudeFailure('task_not_found', CLAUDE_MESSAGES.taskNotFound)
    return task
  }

  private async taskState(taskId: string): Promise<TaskRunsState> {
    const runs = this.deps.runs.list(taskId)
    const active = runs.find((r) => r.status === 'queued' || r.status === 'running')
    const wt = this.deps.worktrees.get(taskId)
    let workspace: TaskWorkspace | null = null
    if (wt) {
      const changes = await this.deps.git
        .statusPorcelain(wt.path)
        .then((l) => l.length)
        .catch(() => null)
      workspace = { branch: wt.branch, path: wt.path, changes }
    }
    return { runs, activeRunId: active?.id ?? null, workspace }
  }

  /** Branch local/remota já existente para a tarefa (só para exibir antes de rodar). */
  private async existingBranch(project: StoredProject, displayId: string): Promise<string | null> {
    const parsed = parseDisplayId(displayId)
    if (!parsed) return null
    const matches = (b: string): boolean => mentionsTask(b, parsed.prefix, parsed.number)
    try {
      const local = await this.deps.git.localBranches(project.localPath)
      const hit = local.find(matches)
      if (hit) return hit
      const remote = project.repo?.remoteName ?? 'origin'
      const remotes = await this.deps.git.remoteBranches(project.localPath, remote)
      const r = remotes.find(matches)
      return r ? r.slice(remote.length + 1) : null
    } catch {
      return null
    }
  }

  /** Contexto do projeto em markdown, dentro do limite; páginas ilegíveis viram aviso. */
  private async projectContext(
    projectId: string
  ): Promise<{ markdown: string; warnings: string[] }> {
    const ctx = this.deps.config.get().claudeContexts[projectId]
    if (!ctx || (!ctx.instructions.trim() && ctx.notionPages.length === 0)) {
      return { markdown: '', warnings: [] }
    }
    const warnings: string[] = []
    const pages: { name: string; markdown: string }[] = []
    for (const ref of ctx.notionPages) {
      try {
        pages.push({
          name: ref.name,
          markdown: blocksToMarkdown(await this.pageBlocks(ref.id)).markdown
        })
      } catch (error) {
        console.error(`[orkio] contexto: página indisponível: ${errorName(error)}`)
        warnings.push(`Não deu para ler a página “${ref.name}” no Notion; ela ficou de fora.`)
      }
    }
    const built = buildProjectContext(
      { instructions: ctx.instructions, pages },
      CONTEXT_LIMITS.total
    )
    return { markdown: built.markdown, warnings: [...warnings, ...built.warnings] }
  }

  /** Blocos da página (filhos até MAX_DEPTH, no máximo MAX_BLOCKS no total). */
  private async pageBlocks(pageId: string): Promise<NotionBlock[]> {
    let budget = MAX_BLOCKS
    const load = async (id: string, depth: number): Promise<NotionBlock[]> => {
      const out: NotionBlock[] = []
      let cursor: string | null = null
      do {
        const page = await this.deps.getBlockChildren(id, cursor)
        for (const raw of page.results) {
          if (budget <= 0) return out
          if (!isBlock(raw)) continue
          budget--
          const block: NotionBlock = { ...raw }
          if (raw.has_children === true && depth < MAX_DEPTH && typeof raw.id === 'string') {
            block.children = await load(raw.id, depth + 1)
          }
          out.push(block)
        }
        cursor = page.nextCursor
      } while (cursor && budget > 0)
      return out
    }
    return load(pageId, 0)
  }

  private async wrap<T>(run: () => Promise<ClaudeResult<T>>): Promise<ClaudeResult<T>> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof ClaudeFailure) return fail(error.code, error.message)
      if (error instanceof ArtifactError) return fail(error.code, error.message)
      if (error instanceof NotionApiError) {
        return fail(error.code, error.message)
      }
      if (error instanceof WorktreeError) {
        return fail(error.code, error.message, error.files.length ? error.files : undefined)
      }
      if (error instanceof Error && error.message === RUN_MESSAGES.busy) {
        return fail('busy', error.message)
      }
      console.error(`[orkio] claude: ${errorName(error)}`)
      return fail('unexpected', CLAUDE_MESSAGES.generic)
    }
  }
}

class ClaudeFailure extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ClaudeFailure'
  }
}

function ok<T>(value: T): ClaudeResult<T> {
  return { ok: true, value }
}

function fail<T>(code: string, message: string, files?: string[]): ClaudeResult<T> {
  return { ok: false, error: { code, message, ...(files ? { files } : {}) } }
}

function isBlock(v: unknown): v is NotionBlock {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string'
}

/** Página do resultado de busca → id + título (propriedade do tipo title). */
function pageRef(value: unknown): { id: string; name: string }[] {
  if (typeof value !== 'object' || value === null) return []
  const v = value as { id?: unknown; object?: unknown; properties?: unknown }
  if (typeof v.id !== 'string' || v.object !== 'page') return []
  let name = ''
  if (typeof v.properties === 'object' && v.properties !== null) {
    for (const prop of Object.values(v.properties as Record<string, unknown>)) {
      const p = prop as { type?: unknown; title?: unknown }
      if (p.type === 'title' && Array.isArray(p.title)) {
        name = p.title
          .map((t) =>
            typeof (t as { plain_text?: unknown }).plain_text === 'string'
              ? (t as { plain_text: string }).plain_text
              : ''
          )
          .join('')
        break
      }
    }
  }
  return [{ id: v.id, name: name.trim() || 'Sem título' }]
}

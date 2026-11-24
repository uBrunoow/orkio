/**
 * Fachada do Claude Code (Etapa 4A) para o IPC: detecção, preparo (briefing do Notion + branch),
 * execução, permissões, ambiente (worktree), editor e diff.
 *
 * O renderer só manda ids (projeto, tarefa, execução); caminhos e nomes de branch são resolvidos
 * aqui. Conteúdo das páginas do Notion fica só em memória (briefing) e no log da execução.
 */
import { isProtectedBranch, type DeliveryTarget } from '../../shared/delivery'
import { isBranchName } from '../../shared/github-names'
import { isCommandName, parsePorcelainLine } from '../../shared/agent-run'
import { isScratchPath } from '../../shared/orkio-scratch'
import type {
  ArtifactCandidate,
  ArtifactPublishMode,
  ArtifactView,
  CatalogGroup,
  ClaudeCodeStatus,
  ClaudeDiff,
  TaskBranchesView,
  EditorId,
  RunLogEvent,
  RunPreparation,
  SendMessageRequest,
  StartRunRequest,
  TaskRunsState,
  TaskWorkspace,
  UncommittedFile
} from '../../shared/agent-run'
import { blocksToMarkdown, buildBriefing, type NotionBlock } from '../../shared/briefing'
import { taskBranchName } from '../../shared/slug'
import { parseDisplayId } from '../../shared/task-id-match'
import type { OrkioConfig, StoredProject } from '../config/orkio-config'
import type { Git } from '../git/git'
import { errorName } from '../errors'
import { ArtifactError, type ArtifactsService } from './artifacts.service'
import { buildCatalog } from './catalog'
import { redactSecrets } from './redact'
import { isEffort, isModelName, resolveRuntime } from '../../shared/agent-runtime'
import { RunBusyError, type RunService } from './run.service'
import type {
  GithubDeliver,
  GithubRead,
  RunAgent,
  RunRequest,
  RunSession,
  RunSpec
} from './run-spec'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { attachmentNote, checkAttachments, saveAttachments } from './attachments'
import { TerminalError } from './terminal'
import {
  WorktreeError,
  type WorktreeProject,
  type WorktreeRecord,
  type WorktreeService
} from './worktree.service'
import type { Result } from '../../shared/result'
import type { NotionTask } from '../../shared/notion'
import type { TaskSignalsResult } from '../../shared/task-signals'
import { projectById } from '../config/queries'
import { isApiError } from '../net/http'

export const CLAUDE_MESSAGES = {
  projectNotFound: 'Projeto não encontrado. Atualize a lista de projetos.',
  noRepo: 'Este projeto não tem repositório do GitHub detectado.',
  taskNotFound: 'Tarefa não encontrada no Notion. Atualize o quadro.',
  notInstalled: 'Claude Code não encontrado. Instale o CLI e faça login para rodar tarefas.',
  notLoggedIn: 'O Claude Code não está logado. Rode `claude` no terminal e faça login.',
  tooOld: 'Atualize o Claude Code para rodar tarefas pelo Orkio.',
  noWorkspace: 'Esta tarefa ainda não tem pasta de trabalho. Rode o Claude Code primeiro.',
  invalidBranch: 'Nome de branch inválido. Use letras, números, "-", "_", "." e "/".',
  protectedBranch: (b: string) =>
    `“${b}” é uma branch protegida (padrão, release, hotfix…): não dá para ligá-la a uma tarefa.`,
  editor: 'Não foi possível abrir o editor. Confira se o comando está instalado no PATH.',
  terminal: 'Não achei um terminal neste computador.',
  invalidCommand: 'Nome de comando inválido.',
  emptyPrompt: 'Escreva o que o Claude Code deve fazer.',
  flowActive:
    'Esta tarefa tem um fluxo em andamento. Use o fluxo (ou cancele-o) para rodar o Claude Code.',
  noSession: 'Esta tarefa não tem uma sessão do Claude Code para continuar. Rode o passo de novo.',
  flowRunning:
    'O fluxo está rodando um passo agora. Espere ele parar ou pedir algo para mandar a mensagem.',
  pageUnavailable: 'Não deu para ler a página da tarefa no Notion; o briefing usa só os campos.',
  noDescription:
    'A tarefa está sem descrição no Notion. Escreva o que precisa ser feito na página da tarefa e retome o fluxo.',
  generic: 'Algo deu errado. Tente novamente.'
} as const

const MAX_DEPTH = 3
const MAX_BLOCKS = 400
const MAX_DIFF_CHARS = 400_000

export interface ClaudeServiceDeps {
  /**
   * Modo entrega (5C): alvo da entrega (repositório + branch da tarefa) e o ajuste do projeto.
   * Lança erro com mensagem pt-BR se não houver repositório verificado/ambiente.
   */
  deliveryTarget?(
    projectId: string,
    taskId: string
  ): { target: DeliveryTarget; requirePushApproval: boolean }
  config: { get(): OrkioConfig }
  worktrees: WorktreeService
  runs: RunService
  git: Pick<
    Git,
    'statusPorcelain' | 'diffText' | 'diffShortstat' | 'localBranches' | 'remoteBranches'
  >
  listTasks(projectId: string): Promise<Result<{ tasks: NotionTask[] }>>
  signals(projectId: string): Promise<Result<TaskSignalsResult>>
  /** Leitura dos blocos de uma página (o token fica no conector). */
  getBlockChildren(
    id: string,
    cursor: string | null
  ): Promise<{ results: unknown[]; nextCursor: string | null }>
  detect(): Promise<ClaudeCodeStatus>
  artifacts: ArtifactsService
  /** 5A: a tarefa tem fluxo ativo? (bloqueia a execução manual). */
  flowActive?: (taskId: string) => boolean
  /**
   * 5A: o fluxo está rodando (ou vai começar sozinho) um passo agora? Bloqueia a mensagem da
   * sessão; um fluxo esperando você (gate, pausa, escolha) aceita a conversa.
   */
  flowBusy?: (taskId: string) => boolean
  /**
   * Mensagem do campo com um fluxo ativo: o fluxo usa (escolha, interromper o passo, responder e
   * continuar) → `used`; erro esperado (pt-BR) → `error`; senão vai para o Claude como sempre.
   */
  flowMessage?: (
    taskId: string,
    text: string,
    note?: string
  ) => Promise<{ used: boolean } | { error: string }>
  /** Abre a pasta no editor (execFile, sem shell). */
  openEditor(editor: EditorId, path: string): Promise<void>
  /** Abre o terminal do sistema na pasta (`TerminalError` se a pasta sumiu ou não há terminal). */
  openTerminal(path: string): Promise<void>
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

  onRunEvent(event: RunLogEvent): void {
    if (event.kind === 'init' && event.commands.length > 0) this.commands = [...event.commands]
  }

  state(projectId: string, taskId: string): Promise<Result<TaskRunsState>> {
    return this.wrap(async () => {
      this.project(projectId)
      return ok(await this.taskState(taskId))
    })
  }

  prepare(projectId: string, taskId: string): Promise<Result<RunPreparation>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const task = await this.task(projectId, taskId)
      const parsed = parseDisplayId(task.displayId)
      const state = await this.taskState(taskId)
      const existing =
        state.workspace?.branch ??
        (await this.deps.worktrees
          .findTaskBranch(this.worktreeProject(project), task)
          .then((f) => f?.branch ?? null)
          .catch(() => null))
      const branch = existing ?? taskBranchName(parsed ? task.displayId : null, task.title)

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
        pr
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
        branchIsNew: existing === null,
        commands: this.commands,
        descriptionEmpty: !pageWarning && pageMarkdown.trim() === ''
      })
    })
  }

  start(req: StartRunRequest): Promise<Result<TaskRunsState>> {
    return this.wrap(async () => {
      // 5A: com fluxo ativo, quem roda o Claude Code na tarefa é o fluxo.
      if (this.deps.flowActive?.(req.taskId)) return fail('flow_active', CLAUDE_MESSAGES.flowActive)
      const command = req.mode === 'command' ? (req.command ?? '') : null
      const agent = await this.agentForRun(req.projectId, req.taskId, req.asAgent, command)
      if (!agent.ok) return agent
      const started = await this.startRun({
        projectId: req.projectId,
        taskId: req.taskId,
        input:
          command !== null
            ? { kind: 'command', name: command, args: req.text }
            : { kind: 'prompt', text: req.text },
        session: { kind: 'new', briefing: req.briefing, includeBriefing: true },
        access: { tools: 'full', github: 'read' },
        agent: agent.value,
        runtime: null,
        timeoutMin: null,
        ...(req.branchKind ? { branchKind: req.branchKind } : {})
      })
      if (!started.ok) return started
      return ok(await this.taskState(req.taskId))
    })
  }

  /**
   * Mensagem do campo da sessão: continua a última sessão do Claude Code da tarefa (`--resume`,
   * mesmo worktree, sem repetir o briefing) ou, sem sessão (ou com `fresh`), começa uma com o
   * briefing do Notion. `/comando args` roda o comando instalado.
   */
  send(req: SendMessageRequest): Promise<Result<TaskRunsState>> {
    return this.wrap(async () => {
      const text = req.text.trim()
      if (!text) return fail('invalid', CLAUDE_MESSAGES.emptyPrompt)
      // Anexos: validados pelo conteúdo antes de qualquer efeito; gravados no worktree da tarefa
      // só depois das recusas baratas (CLI, fluxo ocupado, briefing, agente) e apagados se a
      // mensagem acabar recusada. O fluxo ativo já tem worktree: lá gravamos antes de entregar.
      const files = (req.attachments ?? []).map((a) => ({ name: a.name, data: a.data }))
      if (files.length > 0) {
        const checked = checkAttachments(files)
        if (!checked.ok) return fail('attachment', checked.message)
        const pre = await this.cliRefusal()
        if (pre) return pre
      }
      let wtPath: string | null = null
      let saved: string[] = []
      const save = async (): Promise<string> => {
        if (files.length === 0) return ''
        if (saved.length > 0) return attachmentNote(saved)
        const { worktree: wt } = await this.ensureForTask(req.projectId, req.taskId)
        wtPath = wt.path
        saved = await saveAttachments(wt.path, files)
        return attachmentNote(saved)
      }
      const discard = async (): Promise<void> => {
        const root = wtPath
        const paths = saved
        saved = []
        if (!root) return
        await Promise.all(paths.map((rel) => rm(join(root, rel), { force: true }).catch(() => {})))
      }
      try {
        const r = await this.sendChecked(req, text, files.length > 0, save)
        if (!r.ok) await discard()
        return r
      } catch (error) {
        await discard()
        throw error
      }
    })
  }

  private async cliRefusal(): Promise<Result<never> | null> {
    const cli = await this.readyCli()
    return cli.ok ? null : cli
  }

  private async readyCli(): Promise<Result<ClaudeCodeStatus>> {
    const status = await this.getStatus(true)
    if (!status.installed) return fail('not_installed', CLAUDE_MESSAGES.notInstalled)
    if (status.loggedIn === false) return fail('not_logged_in', CLAUDE_MESSAGES.notLoggedIn)
    if (!status.meetsMinimum) return fail('too_old', CLAUDE_MESSAGES.tooOld)
    return ok(status)
  }

  private async agentForRun(
    projectId: string,
    taskId: string,
    asAgent: boolean | undefined,
    command: string | null
  ): Promise<Result<RunAgent | null>> {
    if (asAgent === false || !this.deps.agentFor) return ok(null)
    try {
      return ok(await this.deps.agentFor(projectId, taskId, command))
    } catch (error) {
      return fail('agent', error instanceof Error ? error.message : 'Agente indisponível.')
    }
  }

  private async sendChecked(
    req: SendMessageRequest,
    text: string,
    hasFiles: boolean,
    save: () => Promise<string>
  ): Promise<Result<TaskRunsState>> {
    // Como no Claude Code: a mensagem não espera o piloto automático; o fluxo a usa (escolha,
    // interromper o passo e continuar com ela, responder e continuar).
    if (this.deps.flowMessage) {
      const note = hasFiles && (this.deps.flowActive?.(req.taskId) ?? false) ? await save() : ''
      const used = await this.deps.flowMessage(req.taskId, text, note)
      if ('error' in used) return fail('flow_message', used.error)
      if (used.used) return ok(await this.taskState(req.taskId))
    }
    const busy = this.deps.flowBusy ?? this.deps.flowActive
    if (busy?.(req.taskId)) return fail('flow_running', CLAUDE_MESSAGES.flowRunning)
    // Execução avulsa no meio de um turno: interrompe e continua a sessão com a mensagem.
    const current = (await this.taskState(req.taskId)).activeRunId
    if (current) await this.cancelAndWait(current)
    const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text)
    const command = slash ? slash[1]! : null
    let args = slash ? (slash[2] ?? '').trim() : text
    const last = req.fresh ? null : this.deps.runs.lastSession(req.taskId)
    let session: RunSession
    if (last) session = { kind: 'resume', id: last }
    else {
      const prep = await this.prepare(req.projectId, req.taskId)
      if (!prep.ok) return prep
      session = { kind: 'new', briefing: prep.value.briefing, includeBriefing: true }
    }
    const agent = await this.agentForRun(req.projectId, req.taskId, req.asAgent, command)
    if (!agent.ok) return agent
    args += await save()
    const started = await this.startRun({
      projectId: req.projectId,
      taskId: req.taskId,
      input:
        command !== null
          ? { kind: 'command', name: command, args }
          : { kind: 'prompt', text: args },
      session,
      access: { tools: 'full', github: 'read' },
      agent: agent.value,
      runtime: req.runtime ?? null,
      timeoutMin: null
    })
    if (!started.ok) return started
    return ok(await this.taskState(req.taskId))
  }

  /**
   * Garante o worktree da tarefa (cria ou recria) e devolve o caminho. Para ações do Orkio que
   * gravam no ambiente (ex.: `review_snapshot`); `null` se projeto/tarefa não existem; erro do
   * worktree é lançado.
   */
  async ensureWorktreePath(projectId: string, taskId: string): Promise<string | null> {
    try {
      this.project(projectId)
      await this.task(projectId, taskId)
    } catch {
      return null
    }
    // Erros do WorktreeService (mensagem pt-BR) sobem para o passo do fluxo.
    return (await this.ensureForTask(projectId, taskId)).worktree.path
  }

  /** Contexto de um fluxo (5A): briefing do Notion, ID e URL da tarefa. */
  flowContext(
    projectId: string,
    taskId: string
  ): Promise<
    Result<{ briefing: string; displayId: string; title: string; notionUrl: string | null }>
    // displayId '' = tarefa sem ID do Notion (as variáveis do fluxo ficam vazias).
  > {
    return this.wrap(async () => {
      const prep = await this.prepare(projectId, taskId)
      if (!prep.ok) return prep
      // Fluxo (piloto automático) não começa sem saber o que fazer: a página vazia para aqui.
      if (prep.value.descriptionEmpty) return fail('no_description', CLAUDE_MESSAGES.noDescription)
      const task = await this.task(projectId, taskId)
      return ok({
        briefing: prep.value.briefing,
        displayId: prep.value.displayId ?? '',
        title: task.title,
        notionUrl: task.url
      })
    })
  }

  /**
   * A única entrada das execuções (manual, mensagem, passo de fluxo): resolve o pedido uma vez
   * (sessão, worktree, alvo do GitHub, modelo/raciocínio cortados pela versão do CLI) e roda.
   */
  startRun(request: RunRequest): Promise<Result<string>> {
    return this.wrap(async () => {
      this.project(request.projectId)
      const cli = await this.readyCli()
      if (!cli.ok) return cli
      const { input } = request
      if (input.kind === 'command' && !isCommandName(input.name)) {
        return fail('invalid', CLAUDE_MESSAGES.invalidCommand)
      }
      if (input.kind === 'prompt' && !input.text.trim()) {
        return fail('invalid', CLAUDE_MESSAGES.emptyPrompt)
      }
      let session: RunSession
      if (request.session.kind === 'latest') {
        const last = this.deps.runs.lastSession(request.taskId)
        if (last) session = { kind: 'resume', id: last }
        else if (request.session.orNew) session = request.session.orNew
        else return fail('no_session', CLAUDE_MESSAGES.noSession)
      } else session = request.session
      const { project, wtProject, task } = await this.ensureForTask(
        request.projectId,
        request.taskId,
        request.branchKind
      )
      // Fora da entrega, o repositório só libera a leitura da PR; sem ele, nada muda.
      const read = (): GithubRead => {
        try {
          const t = this.deps.deliveryTarget?.(request.projectId, request.taskId)
          return t ? { mode: 'read', target: t.target } : null
        } catch {
          return null
        }
      }
      let access: RunSpec['access']
      if (request.access.tools === 'read_only') access = { tools: 'read_only', github: read() }
      else if (request.access.github === 'read') access = { tools: 'full', github: read() }
      else {
        if (!this.deps.deliveryTarget) return fail('no_repo', CLAUDE_MESSAGES.noRepo)
        let deliver: GithubDeliver
        try {
          const t = this.deps.deliveryTarget(request.projectId, request.taskId)
          deliver = { mode: 'deliver', ...t }
        } catch (error) {
          return fail('no_repo', error instanceof Error ? error.message : CLAUDE_MESSAGES.noRepo)
        }
        access = { tools: 'full', github: deliver }
      }
      // Mensagem/passo > agente > padrão. No agente, `null` = sem preferência (não bloqueia).
      const agent = request.agent
      const resolved = resolveRuntime(
        request.runtime,
        agent
          ? {
              ...(agent.model !== null ? { model: agent.model } : {}),
              ...(agent.effort !== null ? { effort: agent.effort } : {})
            }
          : undefined
      )
      const view = await this.deps.runs.start({
        project: { ...wtProject, name: project.name },
        task,
        input,
        session,
        access,
        agent,
        runtime: {
          // De novo, antes de chegar ao CLI: nome fora do padrão ou raciocínio desconhecido some;
          // CLI sem `--effort`, o raciocínio some (o seletor também some na UI).
          model: isModelName(resolved.model) ? resolved.model : null,
          effort: cli.value.supportsEffort && isEffort(resolved.effort) ? resolved.effort : null
        },
        timeoutMin: request.timeoutMin
      })
      return ok(view.id)
    })
  }

  /** Cancela e espera a execução terminar (até 15 s), para a próxima continuar a sessão. */
  private cancelAndWait(runId: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, 15_000)
      const off = this.deps.runs.onFinished((info) => {
        if (info.runId === runId) done()
      })
      function done(): void {
        clearTimeout(timer)
        off()
        resolve()
      }
      this.deps.runs.cancel(runId)
    })
  }

  /** "Limpar ambiente": remove o worktree (a branch fica). Mudanças pendentes pedem `force`. */
  cleanup(projectId: string, taskId: string, force: boolean): Promise<Result<TaskRunsState>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      if (this.deps.runs.isRunning(taskId)) {
        return fail('busy', 'Cancele a execução em andamento antes de limpar o ambiente.')
      }
      await this.deps.worktrees.remove(this.worktreeProject(project), taskId, force)
      return ok(await this.taskState(taskId))
    })
  }

  openEditor(projectId: string, taskId: string, editor: EditorId): Promise<Result<null>> {
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

  openTerminal(projectId: string, taskId: string): Promise<Result<null>> {
    return this.wrap(async () => {
      this.project(projectId)
      const wt = this.deps.worktrees.get(taskId)
      if (!wt) return fail('no_workspace', CLAUDE_MESSAGES.noWorkspace)
      try {
        await this.deps.openTerminal(wt.path)
      } catch (error) {
        if (error instanceof TerminalError && error.code === 'no_workspace') {
          return fail('no_workspace', CLAUDE_MESSAGES.noWorkspace)
        }
        console.error(`[orkio] terminal: ${errorName(error)}`)
        return fail('terminal', CLAUDE_MESSAGES.terminal)
      }
      return ok(null)
    })
  }

  artifacts(
    projectId: string,
    taskId: string
  ): Promise<Result<{ candidates: ArtifactCandidate[]; attached: ArtifactView[] }>> {
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
  ): Promise<Result<ArtifactView>> {
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
  ): Promise<Result<{ artifact: ArtifactView; url: string | null }>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      return ok(await this.deps.artifacts.publish(artifactId, mode, project.localPath))
    })
  }

  /** `taskId` `null` = catálogo da pasta do projeto (editor de fluxos, sem tarefa). */
  catalog(projectId: string, taskId: string | null): Promise<Result<CatalogGroup[]>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const dir = (taskId && this.deps.worktrees.get(taskId)?.path) || project.localPath
      return ok(await buildCatalog({ projectDir: dir }))
    })
  }

  branches(projectId: string, taskId: string): Promise<Result<TaskBranchesView>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const linked = this.deps.worktrees
        .linkedBranches(projectId, taskId)
        .map((l) => ({ branch: l.branch, source: l.source }))
      const remote = project.repo.remoteName
      const [local, remotes] = await Promise.all([
        this.deps.git.localBranches(project.localPath).catch(() => [] as string[]),
        this.deps.git.remoteBranches(project.localPath, remote).catch(() => [] as string[])
      ])
      const taken = new Set(linked.map((l) => l.branch))
      const available = [...new Set([...local, ...remotes])]
        .filter((b) => !taken.has(b) && !isProtectedBranch(b, project.repo?.defaultBranch ?? null))
        .sort()
      return ok({ linked, available })
    })
  }

  /** Liga uma branch existente à tarefa (sinais, PR, automações e a próxima pasta de trabalho). */
  linkBranch(projectId: string, taskId: string, branch: string): Promise<Result<TaskBranchesView>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const b = branch.trim()
      if (!isBranchName(b)) return fail('invalid', CLAUDE_MESSAGES.invalidBranch)
      if (isProtectedBranch(b, project.repo?.defaultBranch ?? null)) {
        return fail('protected', CLAUDE_MESSAGES.protectedBranch(b))
      }
      this.deps.worktrees.linkBranch(projectId, taskId, b)
      return this.branches(projectId, taskId)
    })
  }

  unlinkBranch(
    projectId: string,
    taskId: string,
    branch: string
  ): Promise<Result<TaskBranchesView>> {
    return this.wrap(async () => {
      this.project(projectId)
      this.deps.worktrees.unlinkBranch(projectId, taskId, branch)
      return this.branches(projectId, taskId)
    })
  }

  diff(projectId: string, taskId: string): Promise<Result<ClaudeDiff>> {
    return this.wrap(async () => {
      this.project(projectId)
      const wt = this.deps.worktrees.get(taskId)
      if (!wt) return fail('no_workspace', CLAUDE_MESSAGES.noWorkspace)
      const text = await this.deps.git.diffText(wt.path, wt.baseRef)
      const status = await this.deps.git.statusPorcelain(wt.path)
      const files = status.map(parsePorcelainLine).filter((f): f is UncommittedFile => f !== null)
      const untracked = files.filter((f) => f.status === 'untracked').map((f) => f.path)
      const uncommitted = files.filter((f) => !isScratchPath(f.path))
      const cut = text.slice(0, MAX_DIFF_CHARS)
      const shortstat = await this.deps.git.diffShortstat(wt.path, wt.baseRef).catch(() => null)
      return ok({
        // O diff aparece na tela (gate, "Ver diff"): segredos saem com o valor escondido, e a
        // lista de arquivos com segredo vira aviso antes de aprovar.
        diff: redactSecrets(cut),
        truncated: text.length > MAX_DIFF_CHARS,
        untracked,
        uncommitted,
        secrets: filesWithSecrets(cut),
        shortstat
      })
    })
  }

  private project(projectId: string): StoredProject & { repo: NonNullable<StoredProject['repo']> } {
    const project = projectById(this.deps.config.get(), projectId)
    if (!project) throw new ClaudeFailure('not_found', CLAUDE_MESSAGES.projectNotFound)
    if (!project.repo) throw new ClaudeFailure('no_repo', CLAUDE_MESSAGES.noRepo)
    return project as StoredProject & { repo: NonNullable<StoredProject['repo']> }
  }

  private async ensureForTask(
    projectId: string,
    taskId: string,
    kind?: StartRunRequest['branchKind']
  ): Promise<{
    project: StoredProject & { repo: NonNullable<StoredProject['repo']> }
    wtProject: WorktreeProject
    task: { id: string; displayId: string | null; title: string }
    worktree: WorktreeRecord
  }> {
    const project = this.project(projectId)
    const wtProject = this.worktreeProject(project)
    const t = await this.task(projectId, taskId)
    const task = { id: t.id, displayId: t.displayId, title: t.title }
    const worktree = await this.deps.worktrees.ensure(wtProject, task, kind ? { kind } : {})
    return { project, wtProject, task, worktree }
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

  private async wrap<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof ClaudeFailure) return fail(error.code, error.message)
      if (error instanceof ArtifactError) return fail(error.code, error.message)
      if (isApiError(error, 'notion')) {
        return fail(error.code, error.message)
      }
      if (error instanceof WorktreeError) {
        return fail(error.code, error.message, error.files.length ? error.files : undefined)
      }
      if (error instanceof RunBusyError) return fail(error.code, error.message)
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

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

function fail<T>(code: string, message: string, files?: string[]): Result<T> {
  return { ok: false, error: { code, message, ...(files ? { files } : {}) } }
}

function isBlock(v: unknown): v is NotionBlock {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string'
}

/** Arquivos do diff com linha adicionada que parece segredo (token, chave, senha). */
export function filesWithSecrets(diff: string): string[] {
  const files = new Set<string>()
  let current: string | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      current = line.slice(4).replace(/^b\//, '')
      continue
    }
    if (
      current &&
      current !== '/dev/null' &&
      line.startsWith('+') &&
      redactSecrets(line) !== line
    ) {
      files.add(current)
    }
  }
  return [...files]
}

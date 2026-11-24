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
import type {
  ArtifactCandidate,
  ArtifactPublishMode,
  ArtifactView,
  CatalogGroup,
  ClaudeCodeStatus,
  ClaudeDiff,
  TaskBranchesView,
  EditorId,
  PermissionAnswer,
  RunLogEvent,
  RunMode,
  RunPreparation,
  SendMessageRequest,
  StartRunRequest,
  TaskRunsState,
  TaskWorkspace,
  UncommittedFile
} from '../../shared/agent-run'
import { blocksToMarkdown, buildBriefing, type NotionBlock } from '../../shared/briefing'
import { taskBranchName } from '../../shared/slug'
import { mentionsTask, parseDisplayId } from '../../shared/task-id-match'
import type { OrkioConfig, StoredProject } from '../config/orkio-config'
import type { Git } from '../git/git'
import { errorName } from '../errors'
import { NotionApiError } from '../connectors/notion/notion.client'
import { ArtifactError, type ArtifactsService } from './artifacts.service'
import { buildCatalog } from './catalog'
import { redactSecrets } from './redact'
import type { RuntimeChoice } from '../../shared/agent-runtime'
import { RUN_MESSAGES, type RunAgent, type RunService } from './run.service'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { attachmentNote, checkAttachments, saveAttachments } from './attachments'
import { WorktreeError, type WorktreeProject, type WorktreeService } from './worktree.service'
import type { Result } from '../../shared/result'
import type { NotionTask } from '../../shared/notion'
import type { TaskSignalsResult } from '../../shared/task-signals'

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

/** Limites da leitura da página: profundidade e total de blocos. */
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
  config: {
    get(): OrkioConfig
    update(fn: (c: OrkioConfig) => OrkioConfig): Promise<unknown>
  }
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
  /** Abre o terminal do sistema na pasta (rejeita se não achar um terminal). */
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

  /** Chamado a cada evento das execuções: guarda os comandos vistos no `init`. */
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
      const existing = state.workspace?.branch ?? (await this.existingBranch(project, task))
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
        const project = this.project(req.projectId)
        const task = await this.task(req.projectId, req.taskId)
        const wt = await this.deps.worktrees.ensure(
          this.worktreeProject(project),
          { id: task.id, displayId: task.displayId, title: task.title },
          {}
        )
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
    const status = await this.getStatus(true)
    if (!status.installed) return fail('not_installed', CLAUDE_MESSAGES.notInstalled)
    if (status.loggedIn === false) return fail('not_logged_in', CLAUDE_MESSAGES.notLoggedIn)
    if (!status.meetsMinimum) return fail('too_old', CLAUDE_MESSAGES.tooOld)
    return null
  }

  private async sendChecked(
    req: SendMessageRequest,
    userText: string,
    hasFiles: boolean,
    save: () => Promise<string>
  ): Promise<Result<TaskRunsState>> {
    {
      const text = userText
      // Como no Claude Code: a mensagem não espera o piloto automático; o fluxo a usa (escolha,
      // interromper o passo e continuar com ela, responder e continuar).
      if (this.deps.flowMessage) {
        const note = hasFiles && (this.deps.flowActive?.(req.taskId) ?? false) ? await save() : ''
        const used = await this.deps.flowMessage(req.taskId, userText, note)
        if ('error' in used) return fail('flow_message', used.error)
        if (used.used) return ok(await this.taskState(req.taskId))
      }
      const busy = this.deps.flowBusy ?? this.deps.flowActive
      if (busy?.(req.taskId)) return fail('flow_running', CLAUDE_MESSAGES.flowRunning)
      // Execução avulsa no meio de um turno: interrompe e continua a sessão com a mensagem.
      const current = (await this.taskState(req.taskId)).activeRunId
      if (current) await this.cancelAndWait(current)
      const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text)
      const mode: RunMode = slash ? 'command' : 'prompt'
      const command = slash ? slash[1]! : null
      let args = slash ? (slash[2] ?? '').trim() : text
      const session = req.fresh ? null : this.deps.runs.lastSession(req.taskId)
      let briefing = ''
      if (!session) {
        const prep = await this.prepare(req.projectId, req.taskId)
        if (!prep.ok) return prep
        briefing = prep.value.briefing
      }
      let agent: RunAgent | null = null
      if (req.asAgent !== false && this.deps.agentFor) {
        try {
          agent = await this.deps.agentFor(req.projectId, req.taskId, command)
        } catch (error) {
          return fail('agent', error instanceof Error ? error.message : 'Agente indisponível.')
        }
      }
      args += await save()
      const started = await this.startRun(
        { projectId: req.projectId, taskId: req.taskId, mode, command, text: args, briefing },
        undefined,
        true,
        false,
        agent,
        session,
        req.runtime ?? null
      )
      if (!started.ok) return started
      return ok(await this.taskState(req.taskId))
    }
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
    /** "Responder e continuar": manda este texto na sessão mais recente da tarefa (`--resume`). */
    reply?: string
    /**
     * Pedido em texto (passo sem comando): continua a sessão mais recente da tarefa com ele, ou
     * começa uma com o briefing quando ainda não há sessão.
     */
    prompt?: string
    /** Passo só de leitura: sem as ferramentas de edição. */
    readOnly?: boolean
    /** Modelo/raciocínio do passo: vencem os do agente. */
    runtime?: Partial<RuntimeChoice> | null
  }): Promise<Result<string>> {
    const readOnly = input.readOnly === true
    if (input.reply !== undefined) {
      const session = this.deps.runs.lastSession(input.taskId)
      if (!session) {
        return Promise.resolve(fail('no_session', CLAUDE_MESSAGES.noSession))
      }
      return this.wrap(() =>
        this.startRun(
          {
            projectId: input.projectId,
            taskId: input.taskId,
            mode: 'prompt',
            command: null,
            text: input.reply!,
            briefing: ''
          },
          input.timeoutMin,
          true,
          input.delivery === true,
          input.agent ?? null,
          session,
          input.runtime ?? null,
          readOnly
        )
      )
    }
    if (input.prompt !== undefined) {
      const session = this.deps.runs.lastSession(input.taskId)
      return this.wrap(() =>
        this.startRun(
          {
            projectId: input.projectId,
            taskId: input.taskId,
            mode: 'prompt',
            command: null,
            text: input.prompt!,
            briefing: session ? '' : input.briefing
          },
          input.timeoutMin,
          // Sessão retomada já leu o briefing; sessão nova recebe (a não ser que o passo recuse).
          session ? true : input.includeBriefing !== false,
          input.delivery === true,
          input.agent ?? null,
          session,
          input.runtime ?? null,
          readOnly
        )
      )
    }
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
        input.agent ?? null,
        null,
        input.runtime ?? null,
        readOnly
      )
    )
  }

  /** Contexto de um fluxo (5A): briefing do Notion, ID e URL da tarefa. */
  /**
   * Garante o worktree da tarefa (cria ou recria) e devolve o caminho. Para ações do Orkio que
   * gravam no ambiente (ex.: `review_snapshot`); `null` se projeto/tarefa não existem; erro do
   * worktree é lançado.
   */
  async ensureWorktreePath(projectId: string, taskId: string): Promise<string | null> {
    let project
    let task
    try {
      project = this.project(projectId)
      task = await this.task(projectId, taskId)
    } catch {
      return null
    }
    // Erros do WorktreeService (mensagem pt-BR) sobem para o passo do fluxo.
    const wt = await this.deps.worktrees.ensure(
      this.worktreeProject(project),
      { id: task.id, displayId: task.displayId, title: task.title },
      {}
    )
    return wt.path
  }

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

  private async startRun(
    req: StartRunRequest,
    timeoutMin?: number,
    includeBriefing = true,
    delivery = false,
    agent: RunAgent | null = null,
    resumeSessionId: string | null = null,
    runtime: Partial<RuntimeChoice> | null = null,
    readOnly = false
  ): Promise<Result<string>> {
    const project = this.project(req.projectId)
    const status = await this.getStatus(true)
    if (!status.installed) return fail('not_installed', CLAUDE_MESSAGES.notInstalled)
    if (status.loggedIn === false) return fail('not_logged_in', CLAUDE_MESSAGES.notLoggedIn)
    if (!status.meetsMinimum) return fail('too_old', CLAUDE_MESSAGES.tooOld)
    if (req.mode === 'command' && !isCommandName(req.command)) {
      return fail('invalid', CLAUDE_MESSAGES.invalidCommand)
    }
    if (req.mode === 'prompt' && !req.text.trim()) {
      return fail('invalid', CLAUDE_MESSAGES.emptyPrompt)
    }
    const task = await this.task(req.projectId, req.taskId)
    const wtProject = this.worktreeProject(project)
    const taskRef = { id: task.id, displayId: task.displayId, title: task.title }
    await this.deps.worktrees.ensure(
      wtProject,
      taskRef,
      req.branchKind ? { kind: req.branchKind } : {}
    )
    let deliveryInput: { target: DeliveryTarget; requirePushApproval: boolean } | null = null
    let githubRead: DeliveryTarget | null = null
    if (delivery) {
      if (!this.deps.deliveryTarget) return fail('no_repo', CLAUDE_MESSAGES.noRepo)
      try {
        deliveryInput = this.deps.deliveryTarget(req.projectId, req.taskId)
      } catch (error) {
        return fail('no_repo', error instanceof Error ? error.message : CLAUDE_MESSAGES.noRepo)
      }
    } else {
      // Fora da entrega, o repositório só libera a leitura da PR; sem ele, nada muda.
      try {
        githubRead = this.deps.deliveryTarget?.(req.projectId, req.taskId).target ?? null
      } catch {
        githubRead = null
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
      githubRead,
      agent: agent && !status.supportsEffort ? { ...agent, effort: null } : agent,
      // CLI sem `--effort`: o raciocínio some (o seletor também some na UI).
      runtime:
        runtime && !status.supportsEffort
          ? { ...(runtime.model !== undefined ? { model: runtime.model } : {}) }
          : runtime,
      resumeSessionId,
      ...(readOnly ? { readOnly: true } : {})
    })
    return ok(view.id)
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
      this.cancel(runId)
    })
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
        if (error instanceof Error && error.message === 'no_workspace') {
          return fail('no_workspace', CLAUDE_MESSAGES.noWorkspace)
        }
        console.error(`[orkio] terminal: ${errorName(error)}`)
        return fail('terminal', CLAUDE_MESSAGES.terminal)
      }
      return ok(null)
    })
  }

  /** Documentos candidatos (alterados no worktree) e artefatos já anexados. */
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

  /** Catálogo de comandos; usa a pasta do worktree da tarefa (ou do projeto) para os do projeto. */
  /** `taskId` `null` = catálogo da pasta do projeto (editor de fluxos, sem tarefa). */
  catalog(projectId: string, taskId: string | null): Promise<Result<CatalogGroup[]>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const dir = (taskId && this.deps.worktrees.get(taskId)?.path) || project.localPath
      return ok(await buildCatalog({ projectDir: dir }))
    })
  }

  /** Branches ligadas à tarefa e as do projeto para escolher ("Vincular branch"). */
  branches(projectId: string, taskId: string): Promise<Result<TaskBranchesView>> {
    return this.wrap(async () => {
      const project = this.project(projectId)
      const linked = this.deps.worktrees
        .linkedBranches(projectId, taskId)
        .map((l) => ({ branch: l.branch, source: l.source }))
      const remote = project.repo?.remoteName ?? 'origin'
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
      const untracked = status.filter((l) => l.startsWith('??')).map((l) => l.slice(3))
      const uncommitted = status
        .map(parsePorcelainLine)
        .filter((f): f is UncommittedFile => f !== null && !f.path.startsWith('.orkio/'))
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

  /**
   * Branch local/remota já existente para a tarefa (só para exibir antes de rodar): a registrada
   * para ela (`task_branches`) ou, com ID do Notion, a que tem o ID no nome. O worktree usa a mesma
   * ordem ao criar.
   */
  private async existingBranch(project: StoredProject, task: NotionTask): Promise<string | null> {
    const parsed = parseDisplayId(task.displayId)
    const linked = this.deps.worktrees.linkedBranches(project.id, task.id).map((l) => l.branch)
    if (!parsed && linked.length === 0) return null
    const matches = (b: string): boolean =>
      linked.includes(b) || (!!parsed && mentionsTask(b, parsed.prefix, parsed.number))
    try {
      const local = await this.deps.git.localBranches(project.localPath)
      const hit = linked.find((b) => local.includes(b)) ?? local.find(matches)
      if (hit) return hit
      const remote = project.repo?.remoteName ?? 'origin'
      // Os nomes já vêm sem o "<remote>/" (git.remoteBranches).
      const remotes = await this.deps.git.remoteBranches(project.localPath, remote)
      return linked.find((b) => remotes.includes(b)) ?? remotes.find(matches) ?? null
    } catch {
      return null
    }
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

  private async wrap<T>(run: () => Promise<Result<T>>): Promise<Result<T>> {
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

/**
 * "Continuar no Claude" (Fase 2). Dono de `session_handoffs` (SQLite v14): a trava da sessão da
 * tarefa enquanto ela está com você no terminal.
 *
 * Começar: interrompe a execução em andamento da tarefa (o passo do fluxo pausa como interrompido)
 * e espera o processo sair (duas instâncias do CLI na mesma sessão brigariam), trava a tarefa e abre
 * `claude --resume <sessão>` no terminal embutido, no worktree da tarefa. Com a trava, o
 * `ClaudeService` recusa toda execução da tarefa (mensagem, "Rodar", passo de fluxo).
 *
 * Devolver: fecha o terminal do Claude (mata o processo), solta a trava e, com o fluxo parado num
 * comando do Claude Code, "O Claude continua o passo" retoma o passo na mesma sessão
 * (`resumeWithReply`) e "Passo feito" conta o passo como certo (`completeByYou`). Sem fluxo,
 * "continua" manda uma mensagem na sessão.
 */
import type { Db } from '../db/database'
import { DomainError } from '../errors'
import { HANDOFF_TEXT, type HandoffReturn, type HandoffView } from '../../shared/handoff'
import { isSessionUuid, type TerminalView } from '../../shared/terminal'
import type { FlowRunView } from '../../shared/task-flow'

export const HANDOFF_MESSAGES = {
  noSession:
    'Esta tarefa ainda não tem uma sessão do Claude Code para continuar. Rode o Claude Code primeiro.',
  noWorkspace: 'Esta tarefa ainda não tem pasta de trabalho. Rode o Claude Code primeiro.',
  notActive: 'A sessão desta tarefa não está com você no terminal. Atualize a tela.',
  locked:
    'A sessão desta tarefa está com você no terminal. Devolva ao Orkio (“O Claude continua o passo” ou “Passo feito”) para ele rodar de novo.'
} as const

export class HandoffError extends DomainError {
  override name = 'HandoffError'
}

export interface HandoffDeps {
  db: Db
  /** Sessão mais recente da tarefa (`RunService.lastSession`). */
  lastSession(taskId: string): string | null
  /** Execução viva da tarefa (rodando ou na fila). */
  activeRun(taskId: string): string | null
  /** Cancela e espera o processo do Claude Code sair. */
  cancelAndWait(runId: string): Promise<void>
  flow: {
    activeFor(
      taskId: string
    ): { id: string; status: FlowRunView['status']; claudeStep: boolean } | null
    continueStep(flowRunId: string, text: string): Promise<unknown>
    completeStep(flowRunId: string): Promise<unknown>
  }
  /** Mensagem na sessão da tarefa (sem fluxo), depois de soltar a trava. */
  sendMessage(projectId: string, taskId: string, text: string): Promise<void>
  worktreePath(taskId: string): string | null
  terminals: {
    readonly available: boolean
    open(input: {
      projectId: string
      taskId: string
      cwd: string
      kind: 'claude'
      sessionId: string
    }): TerminalView
    list(taskId: string): TerminalView[]
    closeTask(taskId: string, kind: 'claude'): Promise<void>
  }
  /** Histórico da tarefa. */
  event(
    ref: { projectId: string; taskId: string },
    e:
      | { kind: 'handoff_started'; detail: { sessionId: string } }
      | { kind: 'handoff_returned'; detail: { mode: HandoffReturn } }
  ): void
  /** Algo mudou na tarefa (visão geral, sino, tela da tarefa). */
  changed(ref: { projectId: string; taskId: string }): void
  now?(): Date
}

interface Row {
  task_page_id: string
  project_id: string
  session_id: string
  flow_run_id: string | null
  started_at: string
}

export class HandoffService {
  /** Uma operação por tarefa de cada vez (dois cliques não abrem dois terminais). */
  private readonly busy = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: HandoffDeps) {}

  /** A sessão da tarefa está com você? (o `ClaudeService` recusa execuções). */
  isLocked(taskId: string): boolean {
    return this.row(taskId) !== null
  }

  get(taskId: string): HandoffView | null {
    const row = this.row(taskId)
    return row ? this.view(row) : null
  }

  /** Todas as sessões com você (visão geral e sino). */
  all(): { projectId: string; taskId: string; since: string }[] {
    return this.deps.db
      .all<Row>('SELECT * FROM session_handoffs ORDER BY started_at')
      .map((r) => ({ projectId: r.project_id, taskId: r.task_page_id, since: r.started_at }))
  }

  start(projectId: string, taskId: string): Promise<HandoffView> {
    return this.serial(taskId, async () => {
      const existing = this.row(taskId)
      if (existing) {
        if (existing.project_id !== projectId) {
          throw new HandoffError('not_found', HANDOFF_MESSAGES.notActive)
        }
        // Já está com você: só reabre o terminal se ele fechou.
        await this.ensureTerminal(existing)
        return this.view(existing)
      }
      const sessionId = this.deps.lastSession(taskId)
      if (!isSessionUuid(sessionId)) {
        throw new HandoffError('no_session', HANDOFF_MESSAGES.noSession)
      }
      const cwd = this.deps.worktreePath(taskId)
      if (!cwd) throw new HandoffError('no_workspace', HANDOFF_MESSAGES.noWorkspace)
      // O passo (ou a execução avulsa) para antes: o processo precisa sair da sessão.
      const runId = this.deps.activeRun(taskId)
      if (runId) await this.deps.cancelAndWait(runId)
      const at = (this.deps.now?.() ?? new Date()).toISOString()
      this.deps.db.run(
        `INSERT INTO session_handoffs (task_page_id, project_id, session_id, flow_run_id, started_at)
         VALUES (?, ?, ?, ?, ?)`,
        taskId,
        projectId,
        sessionId,
        this.deps.flow.activeFor(taskId)?.id ?? null,
        at
      )
      const row = this.row(taskId)!
      try {
        await this.ensureTerminal(row)
      } catch (error) {
        // Sem terminal (sem Claude no PATH, pasta sumiu): a sessão não fica presa com você.
        this.deps.db.run('DELETE FROM session_handoffs WHERE task_page_id = ?', taskId)
        throw error
      }
      this.deps.event({ projectId, taskId }, { kind: 'handoff_started', detail: { sessionId } })
      this.deps.changed({ projectId, taskId })
      return this.view(row)
    })
  }

  /** Reabre o Claude no terminal embutido (fechou ou o app reiniciou). */
  openTerminal(projectId: string, taskId: string): Promise<HandoffView> {
    return this.serial(taskId, async () => {
      const row = this.row(taskId)
      if (!row || row.project_id !== projectId) {
        throw new HandoffError('not_active', HANDOFF_MESSAGES.notActive)
      }
      await this.ensureTerminal(row)
      return this.view(row)
    })
  }

  giveBack(projectId: string, taskId: string, mode: HandoffReturn): Promise<void> {
    return this.serial(taskId, async () => {
      const row = this.row(taskId)
      if (!row || row.project_id !== projectId) {
        throw new HandoffError('not_active', HANDOFF_MESSAGES.notActive)
      }
      // O Claude do terminal sai antes de o Orkio voltar a usar a sessão.
      await this.deps.terminals.closeTask(taskId, 'claude')
      this.deps.db.run('DELETE FROM session_handoffs WHERE task_page_id = ?', taskId)
      this.deps.event({ projectId, taskId }, { kind: 'handoff_returned', detail: { mode } })
      const flow = this.deps.flow.activeFor(taskId)
      const stepWaiting = flow !== null && flow.status === 'paused' && flow.claudeStep
      try {
        if (mode === 'done' && stepWaiting) await this.deps.flow.completeStep(flow.id)
        if (mode === 'continue') {
          if (stepWaiting) await this.deps.flow.continueStep(flow.id, HANDOFF_TEXT.continuePrompt)
          else if (!flow)
            await this.deps.sendMessage(projectId, taskId, HANDOFF_TEXT.continuePrompt)
        }
      } finally {
        this.deps.changed({ projectId, taskId })
      }
    })
  }

  private async ensureTerminal(row: Row): Promise<void> {
    if (!this.deps.terminals.available) return
    const live = this.deps.terminals
      .list(row.task_page_id)
      .some((t) => t.kind === 'claude' && t.state === 'running')
    if (live) return
    const cwd = this.deps.worktreePath(row.task_page_id)
    if (!cwd) throw new HandoffError('no_workspace', HANDOFF_MESSAGES.noWorkspace)
    // Terminais do Claude já terminados saem: a aba mostra só o da sessão de agora.
    await this.deps.terminals.closeTask(row.task_page_id, 'claude')
    this.deps.terminals.open({
      projectId: row.project_id,
      taskId: row.task_page_id,
      cwd,
      kind: 'claude',
      sessionId: row.session_id
    })
  }

  private view(row: Row): HandoffView {
    const terminal = this.deps.terminals
      .list(row.task_page_id)
      .find((t) => t.kind === 'claude' && t.state === 'running')
    const flow = this.deps.flow.activeFor(row.task_page_id)
    return {
      projectId: row.project_id,
      taskId: row.task_page_id,
      sessionId: row.session_id,
      since: row.started_at,
      terminalId: terminal?.id ?? null,
      flowStep: flow !== null && flow.claudeStep
    }
  }

  private row(taskId: string): Row | null {
    return (
      this.deps.db.get<Row>('SELECT * FROM session_handoffs WHERE task_page_id = ?', taskId) ?? null
    )
  }

  private serial<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.busy.get(taskId) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    const tail = next.catch(() => undefined)
    this.busy.set(taskId, tail)
    void tail.then(() => {
      if (this.busy.get(taskId) === tail) this.busy.delete(taskId)
    })
    return next
  }
}

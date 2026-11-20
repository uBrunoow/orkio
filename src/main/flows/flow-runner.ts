/**
 * Executor dos fluxos de tarefa (Etapa 5A). O motor é puro (`shared/task-flow.ts`); aqui ficam a
 * persistência (SQLite `flow_runs`/`flow_steps`), os passos de verdade (execuções da 4A, gates,
 * ações do Orkio), os gatilhos (entrada na etapa / botão) e a retomada depois de reiniciar.
 *
 * Regras:
 * - Um fluxo por tarefa por vez. Cada comando é uma execução da 4A (mesmo worktree e branch, mesmo
 *   limite de paralelismo).
 * - Falha nunca segue sozinha: o fluxo pausa (Retomar deste passo / Pular / Cancelar).
 * - Reiniciar: gate continua em gate; o que estava rodando (ou entre passos) vira "interrompido".
 * - Tarefa saiu da etapa: o passo atual termina, mas o fluxo só avança depois da sua escolha.
 * - Nada de conteúdo do Notion no banco: o briefing fica só em memória (refeito ao retomar).
 */
import { randomUUID } from 'node:crypto'
import {
  afterStep,
  needsYou,
  renderArgs,
  retryStep,
  skipStep,
  startFlow,
  type Flow,
  type FlowDecision,
  type FlowPauseReason,
  type FlowRunStatus,
  type FlowRunView,
  type FlowState,
  type FlowStepStatus,
  type FlowStepView,
  type ProjectFlows,
  type Step,
  type StepEnd
} from '../../shared/task-flow'
import type { BoardStore, TaskEventKind } from '../board/board.store'
import type { StageChange } from '../board/board.service'
import type { RunFinished } from '../claude/run.service'
import { redactSecrets } from '../claude/redact'
import type { Db } from '../db/database'
import { errorName } from '../ipc/payload'

export const FLOW_MESSAGES = {
  noBinding: 'A etapa atual da tarefa não tem fluxo ligado (ou ele está desligado).',
  busy: 'Esta tarefa já tem um fluxo em andamento. Termine ou cancele antes de começar outro.',
  notFound: 'Fluxo não encontrado. Atualize a tela.',
  wrongState: 'O fluxo não está esperando essa ação. Atualize a tela.',
  flowMissing: 'O fluxo ligado a esta etapa não existe mais. Revise o Fluxo do projeto.'
} as const

export class FlowError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'FlowError'
  }
}

/** Extrator: grava variáveis do fluxo a partir do resultado de um comando. */
export interface FlowExtractor {
  id: string
  label: string
  extract(input: { resultText: string }): Record<string, string>
}

/** Ação do próprio Orkio (5C implementa push / pedir review). */
export interface OrkioAction {
  id: string
  label: string
  run(ctx: {
    projectId: string
    taskId: string
    vars: Record<string, string>
  }): Promise<{ ok: true; vars?: Record<string, string> } | { ok: false; message: string }>
}

export interface FlowContext {
  briefing: string
  displayId: string
  notionUrl: string | null
}

export interface FlowRunnerDeps {
  db: Db
  store: BoardStore
  /** Fluxos e ligações do projeto (config). */
  flows(projectId: string): ProjectFlows
  /** Etapa local atual da tarefa. */
  currentStage(projectId: string, taskId: string): string | null
  /** Monta o briefing da tarefa (Notion) e garante o worktree. */
  prepare(projectId: string, taskId: string): Promise<FlowContext>
  /** Inicia uma execução da 4A; devolve o id. Falha esperada: lance `FlowError` (mensagem pt-BR). */
  startClaude(input: {
    projectId: string
    taskId: string
    command: string
    args: string
    briefing: string
    timeoutMin: number
  }): Promise<string>
  cancelClaude(runId: string): void
  extractors: readonly FlowExtractor[]
  actions: readonly OrkioAction[]
  notify(title: string, body: string, ref: { projectId: string; taskId: string }): void
  /** Algo mudou no fluxo da tarefa (a tela recarrega). */
  emit(ref: { projectId: string; taskId: string }): void
  now?: () => Date
  newId?: () => string
}

interface RunRow {
  id: string
  task_page_id: string
  project_id: string
  flow_id: string
  flow_json: string
  stage_id: string | null
  status: FlowRunStatus
  current_step: string | null
  state_json: string
  pause_reason: FlowPauseReason | null
  result: 'done' | 'rejected' | 'cancelled' | null
  started_at: string
  ended_at: string | null
}

interface StepRow {
  id: number
  flow_run_id: string
  step_id: string
  run_id: string | null
  status: FlowStepStatus
  started_at: string
  ended_at: string | null
  result_json: string | null
}

/** O que vai em `state_json`: só ids, chaves e valores curtos (sem conteúdo do Notion). */
interface Persisted {
  engine: FlowState
  displayId: string
  notionUrl: string | null
  /** Passo que terminou enquanto o fluxo esperava sua decisão (tarefa saiu da etapa). */
  pendingEnd?: { stepId: string; end: StepEnd } | null
}

const ACTIVE: readonly FlowRunStatus[] = ['running', 'waiting_gate', 'paused', 'awaiting_decision']

export class FlowRunner {
  private readonly briefings = new Map<string, string>()
  /** Execução da 4A → passo do fluxo. */
  private readonly runIndex = new Map<string, { flowRunId: string; rowId: number }>()
  private readonly gateTimers = new Map<string, NodeJS.Timeout>()
  private readonly locks = new Map<string, Promise<void>>()

  constructor(private readonly deps: FlowRunnerDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  // ---------- Ciclo de vida ----------

  /**
   * Ao abrir o app: o que estava rodando (ou entre passos) vira "interrompido" e pausa; gate
   * continua em gate (timer rearmado); decisão pendente continua pendente.
   */
  init(): void {
    const at = this.now()
    for (const row of this.deps.db.all<RunRow>(
      `SELECT * FROM flow_runs WHERE status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision')`
    )) {
      if (row.status === 'running') {
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'interrupted', ended_at = ? WHERE flow_run_id = ? AND status = 'running'`,
          at,
          row.id
        )
        this.deps.db.run(
          `UPDATE flow_runs SET status = 'paused', pause_reason = 'interrupted' WHERE id = ?`,
          row.id
        )
        this.event(row, 'flow_paused', { reason: 'interrupted', step: row.current_step })
      } else if (row.status === 'awaiting_decision') {
        // O passo que rodava morreu com o app: quando você decidir, ele aparece interrompido.
        this.deps.db.run(
          `UPDATE flow_steps SET status = 'interrupted', ended_at = ? WHERE flow_run_id = ? AND status = 'running'`,
          at,
          row.id
        )
      } else if (row.status === 'waiting_gate') {
        this.armGateTimer(row)
      }
    }
  }

  dispose(): void {
    for (const t of this.gateTimers.values()) clearTimeout(t)
    this.gateTimers.clear()
  }

  // ---------- Gatilhos ----------

  /** Do BoardService (dentro da transação): adia o trabalho. */
  onStageChanged(change: StageChange): void {
    setImmediate(() => void this.handleStageChange(change))
  }

  private async handleStageChange(change: StageChange): Promise<void> {
    try {
      const active = this.activeRow(change.taskId)
      if (active && active.stage_id !== null && change.from === active.stage_id) {
        if (change.to !== active.stage_id) await this.leftStage(active.id)
        return
      }
      // Só entrada real dispara (nunca reconciliação, desfazer ou remoção de etapa).
      if (change.source !== 'manual' && change.source !== 'automation') return
      if (!change.to || active) return
      const binding = this.deps
        .flows(change.projectId)
        .bindings.find((b) => b.stageId === change.to && b.enabled && b.mode === 'on_enter')
      if (!binding) return
      await this.start(change.projectId, change.taskId, change.to, binding.flowId)
    } catch (error) {
      console.error(`[orkio] fluxo (entrada na etapa): ${errorName(error)}`)
    }
  }

  /** Botão "Rodar fluxo": o fluxo ligado à etapa atual (ao entrar ou manual). */
  async startManual(projectId: string, taskId: string): Promise<FlowRunView> {
    const stageId = this.deps.currentStage(projectId, taskId)
    const binding = this.deps
      .flows(projectId)
      .bindings.find((b) => b.stageId === stageId && b.enabled)
    if (!stageId || !binding) throw new FlowError('no_binding', FLOW_MESSAGES.noBinding)
    return this.start(projectId, taskId, stageId, binding.flowId)
  }

  private async start(
    projectId: string,
    taskId: string,
    stageId: string,
    flowId: string
  ): Promise<FlowRunView> {
    if (this.activeRow(taskId)) throw new FlowError('busy', FLOW_MESSAGES.busy)
    const flow = this.deps.flows(projectId).flows.find((f) => f.id === flowId)
    if (!flow) throw new FlowError('flow_missing', FLOW_MESSAGES.flowMissing)
    const id = this.deps.newId?.() ?? randomUUID()
    const persisted: Persisted = {
      engine: { vars: {}, visits: {}, outcomes: {}, executed: 0 },
      displayId: '',
      notionUrl: null
    }
    this.deps.store.transaction(() => {
      this.deps.db.run(
        `INSERT INTO flow_runs (id, task_page_id, project_id, flow_id, flow_json, stage_id, status, state_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
        id,
        taskId,
        projectId,
        flow.id,
        JSON.stringify(flow),
        stageId,
        JSON.stringify(persisted),
        this.now()
      )
      this.event(this.row(id), 'flow_started', { flow: flow.name })
    })
    this.deps.emit({ projectId, taskId })
    await this.withLock(id, async () => {
      const decision = startFlow(flow)
      await this.apply(id, decision)
    })
    return this.view(id)
  }

  // ---------- Ações do usuário ----------

  approveGate(flowRunId: string): Promise<FlowRunView> {
    return this.gateAnswer(flowRunId, 'approved')
  }

  rejectGate(flowRunId: string): Promise<FlowRunView> {
    return this.gateAnswer(flowRunId, 'rejected')
  }

  private async gateAnswer(
    flowRunId: string,
    outcome: 'approved' | 'rejected'
  ): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'waiting_gate' || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      this.clearGateTimer(flowRunId)
      this.closeStep(flowRunId, outcome, null)
      this.event(row, outcome === 'approved' ? 'gate_approved' : 'gate_rejected', {
        step: row.current_step
      })
      const p = this.persisted(row)
      await this.apply(
        flowRunId,
        afterStep(this.flow(row), p.engine, row.current_step, { outcome })
      )
    })
    return this.view(flowRunId)
  }

  /** Retomar deste passo (pausa por falha, interrupção, limite ou gate expirado). */
  async resume(flowRunId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'paused' || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      const p = this.persisted(row)
      // Limite de passos: retomar ainda conta, mas o usuário decidiu seguir (zera a trava).
      const engine = row.pause_reason === 'loop_guard' ? { ...p.engine, executed: 0 } : p.engine
      await this.apply(flowRunId, retryStep(this.flow(row), engine, row.current_step))
    })
    return this.view(flowRunId)
  }

  async skip(flowRunId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'paused' || !row.current_step) {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      this.deps.db.run(
        `UPDATE flow_steps SET status = 'skipped' WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?) AND status IN ('failed', 'interrupted', 'cancelled')`,
        flowRunId
      )
      this.event(row, 'step_skipped', { step: row.current_step })
      const as = row.pause_reason === 'interrupted' ? 'cancelled' : 'failed'
      const p = this.persisted(row)
      await this.apply(flowRunId, skipStep(this.flow(row), p.engine, row.current_step, as))
    })
    return this.view(flowRunId)
  }

  async cancel(flowRunId: string): Promise<FlowRunView> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (!ACTIVE.includes(row.status)) throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      this.clearGateTimer(flowRunId)
      const running = this.deps.db.get<StepRow>(
        `SELECT * FROM flow_steps WHERE flow_run_id = ? AND status IN ('running', 'waiting') ORDER BY id DESC LIMIT 1`,
        flowRunId
      )
      if (running?.run_id) this.deps.cancelClaude(running.run_id)
      if (running) this.closeStep(flowRunId, 'cancelled', 'Fluxo cancelado.')
      this.finishRun(row, 'cancelled', 'cancelled')
    })
    return this.view(flowRunId)
  }

  /** A tarefa saiu da etapa: "Cancelar fluxo" ou "Deixar terminar". */
  async decideLeft(flowRunId: string, choice: 'cancel' | 'continue'): Promise<FlowRunView> {
    if (choice === 'cancel') {
      const row = this.row(flowRunId)
      if (row.status !== 'awaiting_decision') {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      return this.cancel(flowRunId)
    }
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (row.status !== 'awaiting_decision') {
        throw new FlowError('wrong_state', FLOW_MESSAGES.wrongState)
      }
      // Deixa de acompanhar a etapa: a partir daqui o fluxo segue até o fim.
      this.deps.db.run(`UPDATE flow_runs SET stage_id = NULL WHERE id = ?`, flowRunId)
      const p = this.persisted(row)
      const step = this.deps.db.get<StepRow>(
        `SELECT * FROM flow_steps WHERE flow_run_id = ? ORDER BY id DESC LIMIT 1`,
        flowRunId
      )
      if (p.pendingEnd) {
        this.savePersisted(flowRunId, { ...p, pendingEnd: null })
        await this.apply(
          flowRunId,
          afterStep(this.flow(row), p.engine, p.pendingEnd.stepId, p.pendingEnd.end)
        )
      } else if (step?.status === 'running') {
        // O passo ainda roda: volta a "rodando" e o fim dele segue normalmente.
        this.setStatus(flowRunId, 'running', null)
      } else if (step?.status === 'waiting') {
        this.setStatus(flowRunId, 'waiting_gate', null)
        this.armGateTimer(this.row(flowRunId))
      } else if (step?.status === 'interrupted') {
        this.setStatus(flowRunId, 'paused', 'interrupted')
      } else {
        this.setStatus(flowRunId, 'paused', 'step_failed')
      }
    })
    return this.view(flowRunId)
  }

  // ---------- Fim das execuções da 4A ----------

  onRunFinished(info: RunFinished): void {
    const ref = this.runIndex.get(info.runId)
    if (!ref) return
    this.runIndex.delete(info.runId)
    void this.withLock(ref.flowRunId, async () => {
      const row = this.row(ref.flowRunId)
      const current = this.deps.db.get<StepRow>('SELECT * FROM flow_steps WHERE id = ?', ref.rowId)
      if (!current || current.status !== 'running') return
      const step = this.flow(row).steps.find((s) => s.id === current.step_id)
      let end: StepEnd
      if (info.status === 'succeeded') {
        const vars =
          step?.type === 'claude_command' && step.extract
            ? this.extract(step.extract.extractor, info.resultText)
            : {}
        end = { outcome: 'ok', vars }
      } else {
        end = { outcome: info.status === 'cancelled' ? 'cancelled' : 'failed' }
      }
      this.closeStep(
        ref.flowRunId,
        end.outcome === 'ok' ? 'ok' : end.outcome === 'cancelled' ? 'cancelled' : 'failed',
        info.message,
        { costUsd: info.costUsd }
      )
      this.event(row, end.outcome === 'ok' ? 'step_finished' : 'step_failed', {
        step: current.step_id,
        runId: info.runId,
        ...(info.message ? { message: info.message } : {})
      })
      if (row.status === 'awaiting_decision') {
        // Você ainda não decidiu: guarda o fim e espera.
        this.savePersisted(ref.flowRunId, {
          ...this.persisted(row),
          pendingEnd: { stepId: current.step_id, end }
        })
        this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
        return
      }
      if (row.status !== 'running') return
      await this.apply(
        ref.flowRunId,
        afterStep(this.flow(row), this.persisted(row).engine, current.step_id, end)
      )
    }).catch((error: unknown) => {
      console.error(`[orkio] fluxo (fim de execução): ${errorName(error)}`)
    })
  }

  // ---------- Leitura ----------

  /** Fluxo ativo ou o mais recente da tarefa, e os anteriores. */
  list(taskId: string): FlowRunView[] {
    return this.deps.db
      .all<{ id: string }>(
        'SELECT id FROM flow_runs WHERE task_page_id = ? ORDER BY started_at DESC LIMIT 10',
        taskId
      )
      .map((r) => this.view(r.id))
  }

  /** Para o card do quadro: tarefas com fluxo ativo e se ele espera você. */
  activeForProject(projectId: string): Record<string, 'running' | 'needs_you'> {
    const out: Record<string, 'running' | 'needs_you'> = {}
    for (const r of this.deps.db.all<{ task_page_id: string; status: FlowRunStatus }>(
      `SELECT task_page_id, status FROM flow_runs WHERE project_id = ? AND status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision')`,
      projectId
    )) {
      out[r.task_page_id] = needsYou(r.status) ? 'needs_you' : 'running'
    }
    return out
  }

  /** Há fluxo ativo na tarefa? (a execução manual do Claude Code fica bloqueada). */
  hasActive(taskId: string): boolean {
    return this.activeRow(taskId) !== null
  }

  view(flowRunId: string): FlowRunView {
    const row = this.row(flowRunId)
    const flow = this.flow(row)
    const history = this.deps.db
      .all<StepRow>('SELECT * FROM flow_steps WHERE flow_run_id = ? ORDER BY id', flowRunId)
      .map((s, i): FlowStepView => {
        const r = s.result_json
          ? (JSON.parse(s.result_json) as { message?: string; costUsd?: number | null })
          : {}
        return {
          seq: i + 1,
          stepId: s.step_id,
          runId: s.run_id,
          status: s.status,
          startedAt: s.started_at,
          endedAt: s.ended_at,
          message: r.message ?? null,
          costUsd: r.costUsd ?? null
        }
      })
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_page_id,
      flowId: row.flow_id,
      flowName: flow.name,
      steps: flow.steps,
      status: row.status,
      currentStep: row.current_step,
      pauseReason: row.pause_reason,
      result: row.result,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      vars: this.persisted(row).engine.vars,
      history
    }
  }

  // ---------- Interno ----------

  private async apply(flowRunId: string, decision: FlowDecision): Promise<void> {
    const row = this.row(flowRunId)
    const p = this.persisted(row)
    this.savePersisted(flowRunId, { ...p, engine: decision.state })
    if (decision.kind === 'finished') {
      this.finishRun(row, 'finished', decision.result)
      return
    }
    if (decision.kind === 'paused') {
      this.deps.db.run(
        `UPDATE flow_runs SET status = 'paused', pause_reason = ?, current_step = COALESCE(?, current_step) WHERE id = ?`,
        decision.reason,
        decision.stepId,
        flowRunId
      )
      this.event(row, 'flow_paused', { reason: decision.reason, step: decision.stepId })
      this.notifyRow(row, 'Um fluxo precisa de você', this.pauseText(decision.reason, row))
      this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
      return
    }
    await this.runStep(this.row(flowRunId), decision.stepId)
  }

  private async runStep(row: RunRow, stepId: string): Promise<void> {
    const step = this.flow(row).steps.find((s) => s.id === stepId)!
    this.deps.db.run(
      `UPDATE flow_runs SET status = 'running', pause_reason = NULL, current_step = ? WHERE id = ?`,
      stepId,
      row.id
    )
    const at = this.now()
    const rowId = this.deps.db.run(
      `INSERT INTO flow_steps (flow_run_id, step_id, status, started_at) VALUES (?, ?, ?, ?)`,
      row.id,
      stepId,
      step.type === 'gate' ? 'waiting' : 'running',
      at
    ).lastInsertRowid
    this.event(row, step.type === 'gate' ? 'gate_waiting' : 'step_started', { step: stepId })
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })

    switch (step.type) {
      case 'gate':
        this.setStatus(row.id, 'waiting_gate', null)
        this.notifyRow(row, 'Um fluxo espera sua aprovação', step.message)
        this.armGateTimer(this.row(row.id))
        return
      case 'claude_command':
        await this.runClaude(row, step, Number(rowId))
        return
      case 'orkio_action':
        await this.runAction(row, step)
        return
      case 'branch':
        // O motor resolve saltos sozinho; não chega aqui.
        return
    }
  }

  private async runClaude(
    row: RunRow,
    step: Extract<Step, { type: 'claude_command' }>,
    rowId: number
  ): Promise<void> {
    try {
      const ctx = await this.context(row)
      const { text } = renderArgs(step.args, {
        briefingPath: '.orkio/briefing.md',
        taskId: ctx.displayId,
        notionUrl: ctx.notionUrl,
        vars: this.persisted(this.row(row.id)).engine.vars
      })
      const runId = await this.deps.startClaude({
        projectId: row.project_id,
        taskId: row.task_page_id,
        command: step.command,
        args: text,
        briefing: ctx.briefing,
        timeoutMin: step.timeoutMin
      })
      this.deps.db.run('UPDATE flow_steps SET run_id = ? WHERE id = ?', runId, rowId)
      this.runIndex.set(runId, { flowRunId: row.id, rowId })
      this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
    } catch (error) {
      // Não iniciou (Claude Code ausente, worktree...): falha, o fluxo pausa.
      const message =
        error instanceof FlowError ? error.message : 'Não foi possível iniciar o Claude Code.'
      if (!(error instanceof FlowError)) {
        console.error(`[orkio] fluxo (iniciar comando): ${errorName(error)}`)
      }
      this.closeStep(row.id, 'failed', message)
      this.event(row, 'step_failed', { step: step.id, message })
      await this.apply(
        row.id,
        afterStep(this.flow(row), this.persisted(this.row(row.id)).engine, step.id, {
          outcome: 'failed'
        })
      )
    }
  }

  private async runAction(
    row: RunRow,
    step: Extract<Step, { type: 'orkio_action' }>
  ): Promise<void> {
    const action = this.deps.actions.find((a) => a.id === step.action)
    const engine = this.persisted(this.row(row.id)).engine
    let end: StepEnd
    let message: string | null = null
    if (!action) {
      end = { outcome: 'failed' }
      message = `Ação desconhecida: ${step.action}`
    } else {
      try {
        const r = await action.run({
          projectId: row.project_id,
          taskId: row.task_page_id,
          vars: engine.vars
        })
        if (r.ok) end = { outcome: 'ok', ...(r.vars ? { vars: r.vars } : {}) }
        else {
          end = { outcome: 'failed' }
          message = r.message
        }
      } catch (error) {
        console.error(`[orkio] ação do fluxo: ${errorName(error)}`)
        end = { outcome: 'failed' }
        message = 'A ação do Orkio falhou.'
      }
    }
    this.closeStep(row.id, end.outcome === 'ok' ? 'ok' : 'failed', message)
    this.event(row, end.outcome === 'ok' ? 'step_finished' : 'step_failed', {
      step: step.id,
      ...(message ? { message } : {})
    })
    await this.apply(row.id, afterStep(this.flow(row), engine, step.id, end))
  }

  private async leftStage(flowRunId: string): Promise<void> {
    await this.withLock(flowRunId, async () => {
      const row = this.row(flowRunId)
      if (!ACTIVE.includes(row.status) || row.status === 'awaiting_decision') return
      this.clearGateTimer(flowRunId)
      this.setStatus(flowRunId, 'awaiting_decision', 'left_stage')
      this.event(row, 'flow_paused', { reason: 'left_stage', step: row.current_step })
      this.notifyRow(
        row,
        'A tarefa saiu da etapa do fluxo',
        'Escolha no Orkio: cancelar o fluxo ou deixar terminar.'
      )
    })
  }

  private finishRun(row: RunRow, status: 'finished' | 'cancelled', result: RunRow['result']): void {
    this.deps.db.run(
      `UPDATE flow_runs SET status = ?, result = ?, pause_reason = NULL, ended_at = ? WHERE id = ?`,
      status,
      result,
      this.now(),
      row.id
    )
    this.event(row, 'flow_finished', { result })
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
    this.briefings.delete(row.id)
  }

  private closeStep(
    flowRunId: string,
    status: FlowStepStatus,
    message: string | null,
    extra: { costUsd?: number | null } = {}
  ): void {
    const result = { ...(message ? { message } : {}), ...extra }
    this.deps.db.run(
      `UPDATE flow_steps SET status = ?, ended_at = ?, result_json = ? WHERE id = (SELECT MAX(id) FROM flow_steps WHERE flow_run_id = ?)`,
      status,
      this.now(),
      Object.keys(result).length > 0 ? JSON.stringify(result) : null,
      flowRunId
    )
  }

  private setStatus(
    flowRunId: string,
    status: FlowRunStatus,
    reason: FlowPauseReason | null
  ): void {
    this.deps.db.run(
      'UPDATE flow_runs SET status = ?, pause_reason = ? WHERE id = ?',
      status,
      reason,
      flowRunId
    )
    const row = this.row(flowRunId)
    this.deps.emit({ projectId: row.project_id, taskId: row.task_page_id })
  }

  private armGateTimer(row: RunRow): void {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    if (step?.type !== 'gate' || step.timeoutMin === null) return
    const started = this.deps.db.get<StepRow>(
      `SELECT * FROM flow_steps WHERE flow_run_id = ? AND status = 'waiting' ORDER BY id DESC LIMIT 1`,
      row.id
    )
    const since = started ? Date.parse(started.started_at) : Date.now()
    const left = Math.max(0, since + step.timeoutMin * 60_000 - Date.now())
    this.clearGateTimer(row.id)
    this.gateTimers.set(
      row.id,
      setTimeout(() => {
        void this.withLock(row.id, async () => {
          const r = this.row(row.id)
          if (r.status !== 'waiting_gate') return
          this.closeStep(row.id, 'cancelled', 'A aprovação expirou.')
          this.deps.db.run(
            `UPDATE flow_runs SET status = 'paused', pause_reason = 'gate_timeout' WHERE id = ?`,
            row.id
          )
          this.event(r, 'flow_paused', { reason: 'gate_timeout', step: r.current_step })
          this.notifyRow(r, 'Um fluxo precisa de você', FLOW_PAUSE_TEXT.gate_timeout)
          this.deps.emit({ projectId: r.project_id, taskId: r.task_page_id })
        })
      }, left)
    )
  }

  private clearGateTimer(flowRunId: string): void {
    const t = this.gateTimers.get(flowRunId)
    if (t) clearTimeout(t)
    this.gateTimers.delete(flowRunId)
  }

  private async context(row: RunRow): Promise<FlowContext> {
    const cached = this.briefings.get(row.id)
    const p = this.persisted(row)
    if (cached !== undefined && p.displayId) {
      return { briefing: cached, displayId: p.displayId, notionUrl: p.notionUrl }
    }
    const ctx = await this.deps.prepare(row.project_id, row.task_page_id)
    this.briefings.set(row.id, ctx.briefing)
    this.savePersisted(row.id, { ...p, displayId: ctx.displayId, notionUrl: ctx.notionUrl })
    return ctx
  }

  private extract(extractorId: string, resultText: string): Record<string, string> {
    const ex = this.deps.extractors.find((e) => e.id === extractorId)
    if (!ex) return {}
    try {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(ex.extract({ resultText })).slice(0, 20)) {
        if (/^[a-z][a-z0-9_]{0,39}$/.test(k)) out[k] = redactSecrets(String(v)).slice(0, 500)
      }
      return out
    } catch {
      return {}
    }
  }

  private pauseText(reason: FlowPauseReason, row: RunRow): string {
    const step = this.flow(row).steps.find((s) => s.id === row.current_step)
    return `${FLOW_PAUSE_TEXT[reason]}${step ? ` (${step.name})` : ''}`
  }

  private notifyRow(row: RunRow, title: string, body: string): void {
    this.deps.notify(title, body, { projectId: row.project_id, taskId: row.task_page_id })
  }

  private event(row: RunRow, kind: TaskEventKind, detail: Record<string, unknown>): void {
    this.deps.store.addEvent({
      taskPageId: row.task_page_id,
      projectId: row.project_id,
      at: this.now(),
      kind,
      source: 'manual',
      fromStage: null,
      toStage: null,
      detail: { flowRunId: row.id, ...detail }
    })
  }

  private activeRow(taskId: string): RunRow | null {
    return (
      this.deps.db.get<RunRow>(
        `SELECT * FROM flow_runs WHERE task_page_id = ? AND status IN ('running', 'waiting_gate', 'paused', 'awaiting_decision') ORDER BY started_at DESC LIMIT 1`,
        taskId
      ) ?? null
    )
  }

  private row(id: string): RunRow {
    const row = this.deps.db.get<RunRow>('SELECT * FROM flow_runs WHERE id = ?', id)
    if (!row) throw new FlowError('not_found', FLOW_MESSAGES.notFound)
    return row
  }

  private flow(row: RunRow): Flow {
    return JSON.parse(row.flow_json) as Flow
  }

  private persisted(row: RunRow): Persisted {
    return JSON.parse(row.state_json) as Persisted
  }

  private savePersisted(id: string, p: Persisted): void {
    this.deps.db.run('UPDATE flow_runs SET state_json = ? WHERE id = ?', JSON.stringify(p), id)
  }

  /** Operações do mesmo fluxo em fila (fim de execução × clique do usuário). */
  private withLock(id: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    const tail = next.catch(() => undefined)
    this.locks.set(id, tail)
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id)
    })
    return next
  }
}

const FLOW_PAUSE_TEXT: Record<FlowPauseReason, string> = {
  step_failed: 'Um passo falhou. Retome, pule ou cancele o fluxo.',
  interrupted: 'O Orkio foi fechado no meio do passo. Retome, pule ou cancele.',
  loop_guard: 'O fluxo atingiu o limite de passos. Confira se não está em loop.',
  gate_timeout: 'A aprovação expirou. Retome para pedir de novo, pule ou cancele.',
  left_stage: 'A tarefa saiu da etapa do fluxo.'
}

/** Extrator de exemplo: linhas `@orkio chave=valor` no texto final do Claude Code. */
export const ORKIO_LINES_EXTRACTOR: FlowExtractor = {
  id: 'linhas_orkio',
  label: 'Linhas “@orkio chave=valor” no resultado',
  extract({ resultText }) {
    const out: Record<string, string> = {}
    for (const m of resultText.matchAll(/^\s*@orkio\s+([a-z][a-z0-9_]{0,39})\s*=\s*(.*)$/gm)) {
      out[m[1]!] = m[2]!.trim()
    }
    return out
  }
}

/** Ação de teste (5C traz push e pedir review). */
export const NOOP_ACTION: OrkioAction = {
  id: 'noop',
  label: 'Nada (teste)',
  run: async () => ({ ok: true })
}

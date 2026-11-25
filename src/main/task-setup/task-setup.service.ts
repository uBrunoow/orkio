/**
 * "Como deve rodar?" (Fase 1): padrões por coluna (`orkio-config.runSetup`), o que cada tarefa
 * trocou (SQLite `task_run_setup`, dono desta tabela) e o fluxo nativo que a tarefa roda.
 *
 * - A coluna define o padrão; a tarefa troca o que quiser; o resto vem do Orkio.
 * - Travado enquanto a tarefa tem fluxo ativo (vale a cópia feita no início do fluxo).
 * - Quem implementa é o agente atribuído (8A); o revisor nunca é ele.
 */
import type { BoardStage } from '../../shared/board'
import { nativeFlow } from '../../shared/native-flows'
import {
  parseRunSetup,
  resolveRunSetup,
  reviewerProblem,
  TASK_SETUP_MESSAGES,
  type ColumnSetupsView,
  type RunSetup,
  type SetupRuns,
  type TaskSetupView
} from '../../shared/task-setup'
import type { AgentKey } from '../../shared/agent'
import type { OrkioConfig } from '../config/orkio-config'
import { projectFlows } from '../config/queries'
import type { Db } from '../db/database'
import { DomainError } from '../errors'
import type { FlowAgent, NativePlan } from '../flows/flow-runner'
import type { ConfigStore } from '../storage/config-store'

export class TaskSetupError extends DomainError {
  override name = 'TaskSetupError'
}

export interface TaskSetupDeps {
  db: Db
  config: ConfigStore<OrkioConfig>
  /** Etapa local da tarefa (`task_state`). */
  currentStage(taskId: string): string | null
  /** Agente atribuído (8A) e se foi escolhido à mão. */
  assignment(taskId: string): { key: AgentKey; manual: boolean } | null
  /** Nome do agente para a tela (embutido → nome; senão o perfil lido). */
  agentName(projectId: string, key: AgentKey): Promise<string>
  /** O agente pronto para rodar; lança com a mensagem pt-BR quando não pode. */
  runtime(projectId: string, key: AgentKey): Promise<FlowAgent>
  /** Fluxo preferido do agente atribuído (8A), se houver. */
  agentFlow(projectId: string, taskId: string): Promise<string | null>
  hasActiveFlow(taskId: string): boolean
  now?: () => Date
}

export class TaskSetupService {
  constructor(private readonly deps: TaskSetupDeps) {}

  private stages(projectId: string): BoardStage[] {
    return this.deps.config.get().boards[projectId]?.stages ?? []
  }

  /** O que a tarefa trocou (o resto herda). */
  taskSetup(taskId: string): RunSetup {
    const row = this.deps.db.get<{ setup_json: string }>(
      'SELECT setup_json FROM task_run_setup WHERE task_page_id = ?',
      taskId
    )
    if (!row) return {}
    try {
      return parseRunSetup(JSON.parse(row.setup_json)) ?? {}
    } catch {
      return {}
    }
  }

  columnSetup(projectId: string, stageId: string | null): RunSetup {
    if (!stageId) return {}
    return this.deps.config.get().runSetup?.[projectId]?.[stageId] ?? {}
  }

  async view(projectId: string, taskId: string): Promise<TaskSetupView> {
    const stageId = this.deps.currentStage(taskId)
    const stage = this.stages(projectId).find((s) => s.id === stageId) ?? null
    const task = this.taskSetup(taskId)
    const column = this.columnSetup(projectId, stage?.id ?? null)
    const effective = resolveRunSetup(task, column)
    const assigned = this.deps.assignment(taskId)
    const implementer = assigned
      ? {
          key: assigned.key,
          name: await this.deps.agentName(projectId, assigned.key),
          manual: assigned.manual
        }
      : null
    return {
      projectId,
      taskId,
      stage: stage ? { id: stage.id, name: stage.name } : null,
      task,
      column,
      effective,
      implementer,
      runs: await this.runs(projectId, taskId, stage, task, column),
      locked: this.deps.hasActiveFlow(taskId),
      problem: reviewerProblem(assigned?.key ?? null, effective.values.reviewer)
    }
  }

  /** O que roda ao entrar na coluna atual (ou em "Rodar agora"), na ordem do `FlowRunner`. */
  private async runs(
    projectId: string,
    taskId: string,
    stage: BoardStage | null,
    task: RunSetup,
    column: RunSetup
  ): Promise<SetupRuns | null> {
    const pf = projectFlows(this.deps.config.get(), projectId)
    const binding = stage ? pf.bindings.find((b) => b.stageId === stage.id && b.enabled) : null
    const mode = task.mode ?? column.mode ?? null
    if (
      task.mode &&
      nativeFlow(task.mode, { review: false, evidence: false }, stage?.role ?? null)
    ) {
      return { kind: 'native', mode: task.mode }
    }
    const preferred = await this.deps.agentFlow(projectId, taskId).catch(() => null)
    const agentFlow = preferred ? pf.flows.find((f) => f.id === preferred) : undefined
    if (agentFlow && (binding || mode)) {
      return { kind: 'agent_flow', flowId: agentFlow.id, name: agentFlow.name }
    }
    if (mode && nativeFlow(mode, { review: false, evidence: false }, stage?.role ?? null)) {
      return { kind: 'native', mode }
    }
    const flow = binding ? pf.flows.find((f) => f.id === binding.flowId) : undefined
    return flow ? { kind: 'column_flow', flowId: flow.id, name: flow.name } : null
  }

  /** Grava o que a tarefa trocou (`{}` = volta a herdar tudo). */
  async save(projectId: string, taskId: string, setup: RunSetup): Promise<TaskSetupView> {
    if (this.deps.hasActiveFlow(taskId)) {
      throw new TaskSetupError('locked', TASK_SETUP_MESSAGES.locked)
    }
    const clean = parseRunSetup(setup)
    if (!clean) throw new TaskSetupError('invalid', TASK_SETUP_MESSAGES.invalid)
    const assigned = this.deps.assignment(taskId)
    const column = this.columnSetup(projectId, this.deps.currentStage(taskId))
    const problem = reviewerProblem(
      assigned?.key ?? null,
      resolveRunSetup(clean, column).values.reviewer
    )
    // Só recusa quando é a tarefa que escolheu o revisor igual a quem implementa.
    if (problem && clean.reviewer !== undefined) throw new TaskSetupError('same_reviewer', problem)
    if (Object.keys(clean).length === 0) {
      this.deps.db.run('DELETE FROM task_run_setup WHERE task_page_id = ?', taskId)
    } else {
      this.deps.db.run(
        `INSERT INTO task_run_setup (task_page_id, project_id, setup_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(task_page_id) DO UPDATE SET project_id = excluded.project_id, setup_json = excluded.setup_json, updated_at = excluded.updated_at`,
        taskId,
        projectId,
        JSON.stringify(clean),
        (this.deps.now?.() ?? new Date()).toISOString()
      )
    }
    return this.view(projectId, taskId)
  }

  columns(projectId: string): ColumnSetupsView {
    const config = this.deps.config.get()
    const pf = projectFlows(config, projectId)
    const setups = config.runSetup?.[projectId] ?? {}
    return {
      projectId,
      stages: this.stages(projectId).map((s) => {
        const binding = pf.bindings.find((b) => b.stageId === s.id && b.enabled)
        const flow = binding ? pf.flows.find((f) => f.id === binding.flowId) : undefined
        return {
          id: s.id,
          name: s.name,
          role: s.role ?? null,
          setup: setups[s.id] ?? {},
          flow: flow ? { id: flow.id, name: flow.name } : null
        }
      })
    }
  }

  /** Padrão de uma coluna (`{}` = sem padrão: vale o fluxo ligado a ela, se houver). */
  async saveColumn(projectId: string, stageId: string, setup: RunSetup): Promise<ColumnSetupsView> {
    if (!this.stages(projectId).some((s) => s.id === stageId)) {
      throw new TaskSetupError('bad_stage', TASK_SETUP_MESSAGES.noStage)
    }
    const clean = parseRunSetup(setup)
    if (!clean) throw new TaskSetupError('invalid', TASK_SETUP_MESSAGES.invalid)
    await this.deps.config.update((c) => {
      const project = { ...(c.runSetup?.[projectId] ?? {}) }
      if (Object.keys(clean).length === 0) delete project[stageId]
      else project[stageId] = clean
      return { ...c, runSetup: { ...(c.runSetup ?? {}), [projectId]: project } }
    })
    return this.columns(projectId)
  }

  /**
   * Fluxo nativo da tarefa (para o `FlowRunner`). Na entrada na coluna, o modo vale quando a
   * coluna "roda" (tem modo padrão ou fluxo ligado ao entrar); em "Rodar agora" (`manual`), o modo
   * da tarefa vale em qualquer coluna de trabalho. `null` = sem modo: o fluxo da coluna decide.
   */
  async nativePlan(
    projectId: string,
    taskId: string,
    stageId: string | null,
    manual: boolean
  ): Promise<NativePlan | null> {
    const stage = this.stages(projectId).find((s) => s.id === stageId) ?? null
    const task = this.taskSetup(taskId)
    const column = this.columnSetup(projectId, stage?.id ?? null)
    const binding = stage
      ? projectFlows(this.deps.config.get(), projectId).bindings.find(
          (b) => b.stageId === stage.id && b.enabled && (manual || b.mode === 'on_enter')
        )
      : undefined
    const columnRuns = column.mode !== undefined || binding !== undefined
    let source: 'task' | 'column'
    if (task.mode && (manual || columnRuns)) source = 'task'
    else if (column.mode) source = 'column'
    else return null
    const effective = resolveRunSetup(task, column).values
    const mode = source === 'task' ? task.mode! : column.mode!
    const flow = nativeFlow(
      mode,
      { review: effective.reviewer !== null, evidence: effective.evidence },
      stage?.role ?? null
    )
    if (!flow) return null
    const reviewer = effective.reviewer
      ? await this.deps.runtime(projectId, effective.reviewer)
      : null
    return { flow, source, reviewer, model: effective.model }
  }
}

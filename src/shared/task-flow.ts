/**
 * Fluxos de tarefa (Etapa 5A): sequências de passos que rodam numa tarefa, ligadas às etapas do
 * quadro. Não confundir com o "Fluxo do projeto" da 3C (`shared/flow.ts`: etapas + automações).
 *
 * Tudo aqui é puro (sem Node/DOM): tipos, motor (`startFlow`/`afterStep`/`skipStep`), condições,
 * template dos argumentos e validação. Quem executa os passos é o `FlowRunner` no main.
 */

export type StepId = string

/** Resultado de um passo visto pelas condições. */
export type ConditionOutcome = 'ok' | 'failed' | 'cancelled'

export type Condition =
  | { type: 'step'; step: StepId; is: ConditionOutcome }
  | { type: 'var'; key: string; op: 'eq' | 'neq' | 'exists'; value?: string }
  /** Quantas vezes o passo já começou; `lt` limita loops (ex.: menos de 2 voltas). */
  | { type: 'visits'; step: StepId; lt: number }
  | { type: 'all' | 'any'; of: Condition[] }

interface StepBase {
  /** Chave estável (ex.: `revisar`), usada em saltos e condições. */
  id: StepId
  name: string
}

export type ClaudeCommandStep = StepBase & {
  type: 'claude_command'
  /** Comando do catálogo (sem a barra), ex.: `revisar` ou `plugin:comando`. */
  command: string
  /** Template: {{briefing_path}}, {{task_id}}, {{notion_url}}, {{flow.<chave>}}. */
  args: string
  timeoutMin: number
  /** Extrator registrado em código que grava variáveis do fluxo a partir do resultado. */
  extract?: { extractor: string }
  /**
   * Junta o briefing ao texto enviado (padrão: sim). Em comandos que tratam `$ARGUMENTS` como
   * ID (ex.: alva-flow), use `false`: o briefing fica só em `.orkio/briefing.md`.
   */
  includeBriefing?: boolean
  /**
   * Modo entrega (5C): só neste passo, o Claude Code pode criar/atualizar a PR (gh) e fazer push
   * da branch da tarefa, com aprovação na primeira vez. Merge, força e outras branches, nunca.
   */
  delivery?: boolean
}

export type GateStep = StepBase & {
  type: 'gate'
  message: string
  /** `backlog`: a spec/o plano da task do Backlog.md (alva-flow). */
  show: 'diff' | 'summary' | 'backlog' | 'none'
  /** Recusar: vai para este passo (ex.: corrigir) ou encerra o fluxo como recusado. */
  onReject: StepId | 'stop'
  /** `null` = espera sem limite. */
  timeoutMin: number | null
}

export type OrkioActionStep = StepBase & { type: 'orkio_action'; action: string }

export type BranchStep = StepBase & {
  type: 'branch'
  when: Condition
  then: StepId
  /** Sem `else`: segue para o próximo passo. */
  else?: StepId
}

export type Step = ClaudeCommandStep | GateStep | OrkioActionStep | BranchStep
export type StepType = Step['type']

export interface Flow {
  id: string
  name: string
  steps: Step[]
  /** Marcadores (ex.: `alva`, para o limite de fluxos em paralelo por projeto). */
  tags?: string[]
}

export interface StageFlow {
  stageId: string
  flowId: string
  enabled: boolean
  mode: 'on_enter' | 'manual'
}

/** `orkio-config.json` → `flows[projectId]`. */
export interface ProjectFlows {
  flows: Flow[]
  bindings: StageFlow[]
  /** 5B: quantos fluxos Alva podem rodar ao mesmo tempo no projeto (Docker/portas). */
  alva?: { maxParallel: number }
}

/** Alvo especial de um salto: encerra o fluxo (concluído). */
export const FLOW_END = '$fim'

/** Trava de segurança: passos executados (inclui saltos avaliados) num mesmo fluxo. */
export const MAX_EXECUTED_STEPS = 50

// ---------- Estado e motor ----------

export interface FlowState {
  vars: Record<string, string>
  /** Quantas vezes cada passo começou (inclui saltos avaliados). */
  visits: Record<StepId, number>
  /** Último resultado de cada passo, como as condições o enxergam. */
  outcomes: Record<StepId, ConditionOutcome>
  executed: number
}

export type FlowDecision =
  | { kind: 'run'; stepId: StepId; state: FlowState }
  | { kind: 'finished'; result: 'done' | 'rejected'; state: FlowState }
  | {
      kind: 'paused'
      reason: 'step_failed' | 'loop_guard'
      stepId: StepId | null
      state: FlowState
    }

export function initialState(): FlowState {
  return { vars: {}, visits: {}, outcomes: {}, executed: 0 }
}

export function evaluateCondition(c: Condition, state: FlowState): boolean {
  switch (c.type) {
    case 'step':
      return state.outcomes[c.step] === c.is
    case 'var': {
      const v = state.vars[c.key]
      if (c.op === 'exists') return v !== undefined && v !== ''
      if (c.op === 'eq') return v === (c.value ?? '')
      return v !== (c.value ?? '')
    }
    case 'visits':
      return (state.visits[c.step] ?? 0) < c.lt
    case 'all':
      return c.of.every((x) => evaluateCondition(x, state))
    case 'any':
      return c.of.some((x) => evaluateCondition(x, state))
  }
}

function indexOf(flow: Flow, id: StepId): number {
  return flow.steps.findIndex((s) => s.id === id)
}

function visit(state: FlowState, id: StepId): FlowState {
  return {
    ...state,
    visits: { ...state.visits, [id]: (state.visits[id] ?? 0) + 1 },
    executed: state.executed + 1
  }
}

/**
 * A partir do índice `from`, resolve saltos (`branch`) até achar o próximo passo executável.
 * O passo devolvido em `run` já conta a visita (o chamador vai iniciá-lo).
 */
function resolveFrom(flow: Flow, from: number, state: FlowState): FlowDecision {
  let i = from
  let s = state
  for (;;) {
    if (i < 0 || i >= flow.steps.length) return { kind: 'finished', result: 'done', state: s }
    if (s.executed >= MAX_EXECUTED_STEPS) {
      return { kind: 'paused', reason: 'loop_guard', stepId: flow.steps[i]!.id, state: s }
    }
    const step = flow.steps[i]!
    s = visit(s, step.id)
    if (step.type !== 'branch') return { kind: 'run', stepId: step.id, state: s }
    s = { ...s, outcomes: { ...s.outcomes, [step.id]: 'ok' } }
    const target = evaluateCondition(step.when, s) ? step.then : step.else
    if (target === FLOW_END) return { kind: 'finished', result: 'done', state: s }
    i = target === undefined ? i + 1 : indexOf(flow, target)
    if (i < 0) return { kind: 'paused', reason: 'step_failed', stepId: step.id, state: s }
  }
}

export function startFlow(flow: Flow, vars: Record<string, string> = {}): FlowDecision {
  return resolveFrom(flow, 0, { ...initialState(), vars })
}

export type StepEnd =
  | { outcome: 'ok'; vars?: Record<string, string> }
  | { outcome: 'failed' | 'cancelled' }
  | { outcome: 'approved' | 'rejected' }

/** Depois de um passo terminar: segue, salta (gate recusado), pausa (falha) ou conclui. */
export function afterStep(
  flow: Flow,
  state: FlowState,
  stepId: StepId,
  end: StepEnd
): FlowDecision {
  const i = indexOf(flow, stepId)
  const step = flow.steps[i]
  if (!step) return { kind: 'paused', reason: 'step_failed', stepId, state }
  const outcome: ConditionOutcome =
    end.outcome === 'approved' || end.outcome === 'ok'
      ? 'ok'
      : end.outcome === 'cancelled'
        ? 'cancelled'
        : 'failed'
  let s: FlowState = { ...state, outcomes: { ...state.outcomes, [stepId]: outcome } }
  if (end.outcome === 'ok' && end.vars) s = { ...s, vars: { ...s.vars, ...end.vars } }

  if (end.outcome === 'rejected' && step.type === 'gate') {
    if (step.onReject === 'stop') return { kind: 'finished', result: 'rejected', state: s }
    return resolveFrom(flow, indexOf(flow, step.onReject), s)
  }
  // Falha ou cancelamento nunca seguem sozinhos: o usuário decide (Retomar/Pular/Cancelar).
  if (end.outcome === 'failed' || end.outcome === 'cancelled') {
    return { kind: 'paused', reason: 'step_failed', stepId, state: s }
  }
  return resolveFrom(flow, i + 1, s)
}

/**
 * "Pular": o passo conta como falho (ou cancelado, se foi interrompido) para as condições, e o
 * fluxo segue para o próximo.
 */
export function skipStep(
  flow: Flow,
  state: FlowState,
  stepId: StepId,
  as: 'failed' | 'cancelled'
): FlowDecision {
  const i = indexOf(flow, stepId)
  const s: FlowState = { ...state, outcomes: { ...state.outcomes, [stepId]: as } }
  return resolveFrom(flow, i < 0 ? flow.steps.length : i + 1, s)
}

/** "Retomar deste passo": roda o mesmo passo de novo (conta uma visita). */
export function retryStep(flow: Flow, state: FlowState, stepId: StepId): FlowDecision {
  const i = indexOf(flow, stepId)
  if (i < 0) return { kind: 'paused', reason: 'step_failed', stepId, state }
  if (state.executed >= MAX_EXECUTED_STEPS) {
    return { kind: 'paused', reason: 'loop_guard', stepId, state }
  }
  return { kind: 'run', stepId, state: visit(state, stepId) }
}

// ---------- Template dos argumentos ----------

export interface TemplateContext {
  briefingPath: string
  taskId: string
  taskTitle?: string
  notionUrl: string | null
  vars: Record<string, string>
}

const TEMPLATE_VAR = /\{\{\s*([\w.-]+)\s*\}\}/g
const KNOWN_VARS = new Set(['briefing_path', 'task_id', 'task_title', 'notion_url'])
/** Variáveis de integrações (ex.: `alva.task_id`), gravadas por extratores ou no início do fluxo. */
const NAMESPACED_VAR = /^[a-z][a-z0-9_]*\.[a-z0-9_.]+$/

/** Chave de variável do fluxo (aceita namespace com ponto, ex.: `alva.task_id`). */
export const VAR_KEY = /^[a-z][a-z0-9_.]{0,39}$/

export function renderArgs(
  template: string,
  ctx: TemplateContext
): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = template.replace(TEMPLATE_VAR, (_m, name: string) => {
    if (name === 'briefing_path') return ctx.briefingPath
    if (name === 'task_id') return ctx.taskId
    if (name === 'task_title') return ctx.taskTitle ?? ''
    if (name === 'notion_url') {
      if (ctx.notionUrl) return ctx.notionUrl
      missing.push(name)
      return ''
    }
    if (name.startsWith('flow.')) {
      const v = ctx.vars[name.slice(5)]
      if (v !== undefined) return v
    } else if (NAMESPACED_VAR.test(name)) {
      const v = ctx.vars[name]
      if (v !== undefined) return v
    }
    missing.push(name)
    return ''
  })
  return { text, missing }
}

function templateVars(template: string): string[] {
  return [...template.matchAll(TEMPLATE_VAR)].map((m) => m[1]!)
}

// ---------- Validação ----------

export interface FlowIssue {
  level: 'error' | 'warning'
  stepId: StepId | null
  message: string
}

export interface FlowValidationContext {
  /** Comandos instalados (catálogo da 4B); `null` = catálogo indisponível (não avisa). */
  commands: ReadonlySet<string> | null
  extractors: readonly string[]
  actions: readonly string[]
}

const STEP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/

function hasVisitsLimit(c: Condition): boolean {
  if (c.type === 'visits') return true
  if (c.type === 'all') return c.of.some(hasVisitsLimit)
  return false
}

function conditionSteps(c: Condition): StepId[] {
  if (c.type === 'step' || c.type === 'visits') return [c.step]
  if (c.type === 'all' || c.type === 'any') return c.of.flatMap(conditionSteps)
  return []
}

export function validateTaskFlow(flow: Flow, ctx: FlowValidationContext): FlowIssue[] {
  const issues: FlowIssue[] = []
  const err = (stepId: StepId | null, message: string): void => {
    issues.push({ level: 'error', stepId, message })
  }
  const warn = (stepId: StepId | null, message: string): void => {
    issues.push({ level: 'warning', stepId, message })
  }
  if (!flow.name.trim()) err(null, 'Dê um nome ao fluxo.')
  if (flow.steps.length === 0) err(null, 'O fluxo precisa de pelo menos um passo.')

  const seen = new Set<string>()
  const index = new Map(flow.steps.map((s, i) => [s.id, i]))
  flow.steps.forEach((step, i) => {
    const label = `Passo “${step.name || step.id}”`
    if (!STEP_ID.test(step.id)) {
      err(step.id, `${label}: a chave deve ter letras minúsculas, números, - ou _.`)
    }
    if (seen.has(step.id)) err(step.id, `${label}: chave repetida (${step.id}).`)
    seen.add(step.id)
    if (!step.name.trim()) err(step.id, `Passo ${i + 1}: dê um nome ao passo.`)

    const target = (to: StepId, what: string): number | null => {
      if (to === FLOW_END) return null
      const t = index.get(to)
      if (t === undefined) {
        err(step.id, `${label}: ${what} aponta para um passo que não existe (${to}).`)
        return null
      }
      return t
    }

    switch (step.type) {
      case 'claude_command': {
        if (!step.command.trim()) err(step.id, `${label}: escolha o comando.`)
        else if (ctx.commands && !ctx.commands.has(step.command)) {
          warn(step.id, `${label}: o comando /${step.command} não está instalado no Claude Code.`)
        }
        if (!(step.timeoutMin >= 1 && step.timeoutMin <= 720)) {
          err(step.id, `${label}: o tempo limite deve ficar entre 1 e 720 minutos.`)
        }
        for (const v of templateVars(step.args)) {
          if (!KNOWN_VARS.has(v) && !v.startsWith('flow.') && !NAMESPACED_VAR.test(v)) {
            warn(step.id, `${label}: variável desconhecida {{${v}}} (fica vazia).`)
          }
        }
        if (step.extract && !ctx.extractors.includes(step.extract.extractor)) {
          err(step.id, `${label}: extrator desconhecido (${step.extract.extractor}).`)
        }
        break
      }
      case 'gate':
        if (!step.message.trim()) err(step.id, `${label}: escreva a mensagem do gate.`)
        if (step.onReject !== 'stop') target(step.onReject, 'recusar')
        if (step.timeoutMin !== null && !(step.timeoutMin >= 1 && step.timeoutMin <= 43_200)) {
          err(step.id, `${label}: o tempo limite do gate deve ficar entre 1 minuto e 30 dias.`)
        }
        break
      case 'orkio_action':
        if (!ctx.actions.includes(step.action)) {
          err(step.id, `${label}: ação do Orkio desconhecida (${step.action}).`)
        }
        break
      case 'branch': {
        const thenAt = target(step.then, '“então”')
        const elseAt = step.else !== undefined ? target(step.else, '“senão”') : null
        for (const ref of conditionSteps(step.when)) {
          if (!index.has(ref))
            err(step.id, `${label}: a condição cita um passo que não existe (${ref}).`)
        }
        if (thenAt !== null && thenAt <= i && !hasVisitsLimit(step.when)) {
          err(
            step.id,
            `${label}: volta para trás sem limite. Inclua uma condição de voltas (ex.: menos de 2).`
          )
        }
        if (elseAt !== null && elseAt <= i) {
          err(
            step.id,
            `${label}: o “senão” não pode voltar para trás (não há como limitar). Use o “então” com um limite de voltas.`
          )
        }
        break
      }
    }
  })
  return issues
}

// ---------- Helpers de UI ----------

export const STEP_TYPE_LABEL: Record<StepType, string> = {
  claude_command: 'Comando do Claude Code',
  gate: 'Aprovação (gate)',
  orkio_action: 'Ação do Orkio',
  branch: 'Salto condicional'
}

export function newStepId(flow: Flow, base: string): StepId {
  const clean =
    base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'passo'
  const used = new Set(flow.steps.map((s) => s.id))
  if (!used.has(clean)) return clean
  for (let n = 2; ; n++) if (!used.has(`${clean}-${n}`)) return `${clean}-${n}`
}

// ---------- Execução (visão para a UI) ----------

export type FlowRunStatus =
  'running' | 'waiting_gate' | 'paused' | 'awaiting_decision' | 'finished' | 'cancelled'

export type FlowStepStatus =
  | 'running'
  | 'waiting'
  | 'ok'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'interrupted'
  | 'approved'
  | 'rejected'

/** Por que o fluxo parou e espera você. */
export type FlowPauseReason =
  | 'step_failed'
  | 'interrupted'
  | 'loop_guard'
  | 'gate_timeout'
  | 'left_stage'
  /** Um extrator precisa que você escolha (ex.: qual task do Backlog é desta tarefa). */
  | 'needs_choice'
  /** Limite de fluxos em paralelo no projeto: começa sozinho quando outro terminar. */
  | 'waiting_slot'
  /** Limite de fluxos em paralelo do agente (8A): começa sozinho quando outro terminar. */
  | 'waiting_agent'
  /** Limite diário do agente (8A): "Retomar" passa por cima uma vez. */
  | 'agent_daily_limit'

export interface FlowStepView {
  seq: number
  stepId: StepId
  /** Execução do Claude Code (4A), quando o passo é um comando. */
  runId: string | null
  status: FlowStepStatus
  startedAt: string
  endedAt: string | null
  message: string | null
  costUsd: number | null
}

export interface FlowRunView {
  id: string
  projectId: string
  taskId: string
  flowId: string
  flowName: string
  /** Cópia dos passos do fluxo no início da execução. */
  steps: Step[]
  status: FlowRunStatus
  currentStep: StepId | null
  pauseReason: FlowPauseReason | null
  result: 'done' | 'rejected' | 'cancelled' | null
  startedAt: string
  endedAt: string | null
  vars: Record<string, string>
  history: FlowStepView[]
  /** Escolha pedida por um extrator (`needs_choice`). */
  choice: { prompt: string; options: { value: string; label: string }[] } | null
  /** Confirmação de uma ação do Orkio (5C: push, pedir review) esperando você. */
  confirm: ActionConfirm | null
  /** Agente que roda o fluxo (8A; cópia do perfil feita no início). */
  agent: { key: string; name: string; color: string } | null
}

/** O que uma ação do Orkio mostra antes de agir (gate da ação). */
export interface ActionConfirm {
  title: string
  message: string
  /** Pares rótulo → valor (ex.: Destino → origin/ORK-7/x). */
  details: { label: string; value: string }[]
  /** Commits que vão (push). */
  commits?: { hash: string; subject: string }[]
  /** `git diff --stat`. */
  stat?: string
  /** Escolha de valores antes de aprovar (ex.: revisores). */
  input?: { label: string; options: string[]; selected: string[]; allowOther: boolean }
  approveLabel: string
  /** Link do GitHub (branch ou PR). */
  link?: { label: string; url: string } | null
}

export const FLOW_PAUSE_LABEL: Record<FlowPauseReason, string> = {
  step_failed: 'Um passo falhou',
  interrupted: 'O Orkio foi fechado no meio do passo',
  loop_guard: 'Limite de passos atingido (possível loop)',
  gate_timeout: 'A aprovação expirou',
  left_stage: 'A tarefa saiu da etapa do fluxo',
  needs_choice: 'O fluxo precisa de uma escolha sua',
  waiting_slot: 'Aguardando outro fluxo do projeto terminar',
  waiting_agent: 'Aguardando o agente terminar outra tarefa',
  agent_daily_limit: 'O agente atingiu o limite de hoje'
}

/** Fluxo ativo (não terminado) espera uma ação sua? */
export function needsYou(status: FlowRunStatus): boolean {
  return status === 'waiting_gate' || status === 'paused' || status === 'awaiting_decision'
}

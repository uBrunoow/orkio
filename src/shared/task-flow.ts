/**
 * Fluxos de tarefa (Etapa 5A): sequências de passos que rodam numa tarefa, ligadas às etapas do
 * quadro. Não confundir com o "Fluxo do projeto" da 3C (`shared/flow.ts`: etapas + automações).
 *
 * Tudo aqui é puro (sem Node/DOM): tipos, motor (`startFlow`/`afterStep`/`skipStep`), condições,
 * template dos argumentos e validação. Quem executa os passos é o `FlowRunner` no main.
 */

import { isEffort, isModelName, type Effort } from './agent-runtime'
import { toolsIn } from './claude-tools'
import type { DeliverySettings } from './delivery'
import type { PublishReviewEvent } from './review-publish'
import { isRecord } from './guards'
import { normalizeLabel } from './text'

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
  /**
   * Comando do catálogo (sem a barra), ex.: `revisar` ou `plugin:comando`. Vazio quando o passo é
   * um pedido em texto (`prompt`): exatamente um dos dois.
   */
  command: string
  /** Template: {{briefing_path}}, {{task_id}}, {{notion_url}}, {{flow.<chave>}}. */
  args: string
  /**
   * Pedido em texto (template, mesmas variáveis dos argumentos) em vez de um comando. Roda na
   * sessão mais recente do Claude Code da tarefa (`--resume`) quando existe; senão começa uma com
   * o briefing.
   */
  prompt?: string
  /**
   * Só leitura: o Claude Code não recebe as ferramentas de edição (Edit, Write, MultiEdit,
   * NotebookEdit) e roda em `--permission-mode manual`: nada é aprovado sozinho, todo comando passa
   * pela aprovação do Orkio. Não combina com entrega.
   */
  readOnly?: boolean
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
  /** Modelo só deste passo (vence o do agente); ausente = o do agente ou o padrão do Claude Code. */
  model?: string
  /** Raciocínio só deste passo (vence o do agente). */
  effort?: Effort
}

export type GateStep = StepBase & {
  type: 'gate'
  /** Aceita variáveis do fluxo (ex.: `Aprovar correções da PR #{{review.pr}}`). */
  message: string
  /**
   * `backlog`: a spec/o plano da task do Backlog.md (alva-flow). `result`: o texto final da última
   * execução do Claude Code deste fluxo (ex.: o plano de correções).
   */
  show: GateShow
  /** Recusar: vai para este passo (ex.: corrigir) ou encerra o fluxo como recusado. */
  onReject: StepId | 'stop'
  /** `null` = espera sem limite. */
  timeoutMin: number | null
  /**
   * "Pedir ajustes…": o seu texto volta para `step` (um passo do Claude Code antes do gate), que
   * continua a mesma sessão com ele; depois o gate aparece de novo. No máximo `max` voltas.
   */
  revise?: { step: StepId; max: number }
}

export type GateShow = 'diff' | 'summary' | 'backlog' | 'result' | 'none'
export const GATE_SHOWS: readonly GateShow[] = ['diff', 'summary', 'backlog', 'result', 'none']
/** Limite de voltas de "Pedir ajustes" num gate. */
export const MAX_REVISE = 10
/** Ferramentas que um passo só de leitura não recebe (`--disallowedTools`). */
export const READ_ONLY_DENIED_TOOLS = toolsIn('edit')
/** Tamanho máximo do pedido em texto de um passo e do texto de "Pedir ajustes". */
export const MAX_PROMPT_CHARS = 8000

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

/** Valores de variável "sim/não" gravados pelas ações e extratores (ex.: `pr.pushed`). */
export const FLOW_YES = 'sim'
export const FLOW_NO = 'nao'

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
  /** "Pedir ajustes" já usados em cada gate (ausente em fluxos anteriores = nenhum). */
  revisions?: Record<StepId, number>
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

/** O passo roda um pedido em texto (`prompt`) em vez de um comando do catálogo? */
export function isPromptStep(step: ClaudeCommandStep): boolean {
  return (step.prompt ?? '').trim() !== ''
}

/** Voltas de "Pedir ajustes" já usadas e o limite do gate (`null` = o gate não aceita ajustes). */
export function gateRevisions(
  step: Step | undefined,
  state: FlowState
): { used: number; max: number } | null {
  if (step?.type !== 'gate' || !step.revise) return null
  return { used: state.revisions?.[step.id] ?? 0, max: step.revise.max }
}

export type ReviseDecision =
  FlowDecision | { kind: 'refused'; reason: 'not_revisable' | 'limit'; max: number }

/**
 * "Pedir ajustes" no gate: conta uma volta e roda de novo o passo `revise.step` (que continua a
 * sessão com o seu texto); depois o fluxo segue normalmente e chega ao gate outra vez. Passou do
 * limite → recusado.
 */
export function reviseGate(flow: Flow, state: FlowState, gateId: StepId): ReviseDecision {
  const gate = flow.steps.find((s) => s.id === gateId)
  const r = gateRevisions(gate, state)
  if (!r || gate?.type !== 'gate' || !gate.revise) {
    return { kind: 'refused', reason: 'not_revisable', max: 0 }
  }
  if (r.used >= r.max) return { kind: 'refused', reason: 'limit', max: r.max }
  const target = indexOf(flow, gate.revise.step)
  if (target < 0) return { kind: 'refused', reason: 'not_revisable', max: r.max }
  const s: FlowState = {
    ...state,
    revisions: { ...state.revisions, [gateId]: r.used + 1 }
  }
  return resolveFrom(flow, target, s)
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

/**
 * Texto para a tela (ex.: mensagem do gate): troca `{{flow.<chave>}}` e variáveis com namespace
 * (`{{review.pr}}`) pelos valores do fluxo; o que não tem valor vira `…`.
 */
export function renderMessage(template: string, vars: Record<string, string>): string {
  return template.replace(TEMPLATE_VAR, (_m, name: string) => {
    const v = name.startsWith('flow.')
      ? vars[name.slice(5)]
      : NAMESPACED_VAR.test(name)
        ? vars[name]
        : undefined
    return v !== undefined && v !== '' ? v : '…'
  })
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
  /**
   * Variáveis com namespace que as ações e extratores do Orkio gravam (`shared/flow-outputs.ts`).
   * Chave de um namespace desses que ninguém grava (ex.: `pr.pushd`) é aviso: ficaria vazia.
   */
  declaredVars: ReadonlySet<string>
}

const STEP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/

function hasVisitsLimit(c: Condition): boolean {
  if (c.type === 'visits') return true
  if (c.type === 'all') return c.of.some(hasVisitsLimit)
  return false
}

function conditionVars(c: Condition): string[] {
  if (c.type === 'var') return [c.key]
  if (c.type === 'all' || c.type === 'any') return c.of.flatMap(conditionVars)
  return []
}

/** Chave com namespace do Orkio (`pr.`, `review.`, `alva.`…) que nenhuma ação ou extrator grava. */
function undeclaredVar(key: string, declared: ReadonlySet<string>): boolean {
  const dot = key.indexOf('.')
  if (dot <= 0 || declared.has(key)) return false
  const ns = key.slice(0, dot + 1)
  for (const d of declared) if (d.startsWith(ns)) return true
  return false
}

/** `{{flow.pr.number}}` e `{{pr.number}}` falam da mesma variável. */
function templateKey(name: string): string {
  return name.startsWith('flow.') ? name.slice(5) : name
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
    const checkVar = (key: string): void => {
      if (undeclaredVar(key, ctx.declaredVars)) {
        warn(step.id, `${label}: nenhuma ação do Orkio grava a variável ${key} (fica vazia).`)
      }
    }
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
        const hasCommand = step.command.trim() !== ''
        const hasPrompt = isPromptStep(step)
        if (hasCommand && hasPrompt) {
          err(step.id, `${label}: use um comando ou um pedido em texto, não os dois.`)
        } else if (!hasCommand && !hasPrompt) {
          err(
            step.id,
            step.prompt !== undefined
              ? `${label}: escreva o pedido para o Claude Code.`
              : `${label}: escolha o comando.`
          )
        } else if (hasCommand && ctx.commands && !ctx.commands.has(step.command)) {
          warn(step.id, `${label}: o comando /${step.command} não está instalado no Claude Code.`)
        }
        if ((step.prompt ?? '').length > MAX_PROMPT_CHARS) {
          err(step.id, `${label}: o pedido passa de ${MAX_PROMPT_CHARS} caracteres.`)
        }
        if (step.readOnly === true && step.delivery === true) {
          err(step.id, `${label}: um passo só de leitura não pode estar em modo entrega.`)
        }
        if (!(step.timeoutMin >= 1 && step.timeoutMin <= 720)) {
          err(step.id, `${label}: o tempo limite deve ficar entre 1 e 720 minutos.`)
        }
        for (const v of [...templateVars(step.args), ...templateVars(step.prompt ?? '')]) {
          if (!KNOWN_VARS.has(v) && !v.startsWith('flow.') && !NAMESPACED_VAR.test(v)) {
            warn(step.id, `${label}: variável desconhecida {{${v}}} (fica vazia).`)
          } else if (!KNOWN_VARS.has(v)) checkVar(templateKey(v))
        }
        if (step.model !== undefined && !isModelName(step.model)) {
          err(step.id, `${label}: modelo inválido (use letras minúsculas, números, ponto e hífen).`)
        }
        if (step.effort !== undefined && !isEffort(step.effort)) {
          err(step.id, `${label}: raciocínio inválido.`)
        }
        if (step.extract && !ctx.extractors.includes(step.extract.extractor)) {
          err(step.id, `${label}: extrator desconhecido (${step.extract.extractor}).`)
        }
        break
      }
      case 'gate': {
        if (!step.message.trim()) err(step.id, `${label}: escreva a mensagem do gate.`)
        for (const v of templateVars(step.message)) {
          if (!v.startsWith('flow.') && !NAMESPACED_VAR.test(v)) {
            warn(step.id, `${label}: a mensagem cita {{${v}}}, que o gate não conhece.`)
          } else checkVar(templateKey(v))
        }
        if (step.onReject !== 'stop') target(step.onReject, 'recusar')
        if (step.timeoutMin !== null && !(step.timeoutMin >= 1 && step.timeoutMin <= 43_200)) {
          err(step.id, `${label}: o tempo limite do gate deve ficar entre 1 minuto e 30 dias.`)
        }
        const earlierClaude = flow.steps.slice(0, i).some((s) => s.type === 'claude_command')
        if (step.show === 'result' && !earlierClaude) {
          warn(
            step.id,
            `${label}: mostra o resultado do Claude Code, mas nenhum passo antes dele roda o Claude Code.`
          )
        }
        if (step.revise) {
          const at = target(step.revise.step, '“pedir ajustes”')
          const back = at === null ? undefined : flow.steps[at]
          if (at !== null && (back?.type !== 'claude_command' || at >= i)) {
            err(
              step.id,
              `${label}: “pedir ajustes” precisa voltar a um passo do Claude Code antes do gate.`
            )
          }
          if (
            !Number.isInteger(step.revise.max) ||
            step.revise.max < 1 ||
            step.revise.max > MAX_REVISE
          ) {
            err(step.id, `${label}: o limite de ajustes deve ficar entre 1 e ${MAX_REVISE}.`)
          }
        }
        break
      }
      case 'orkio_action':
        if (!ctx.actions.includes(step.action)) {
          err(step.id, `${label}: ação do Orkio desconhecida (${step.action}).`)
        }
        break
      case 'branch': {
        for (const key of conditionVars(step.when)) checkVar(key)
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
    normalizeLabel(base)
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
  /**
   * Gate: você pediu ajustes (o passo de ajustes rodou de novo e o gate volta depois). No banco é
   * `skipped` com a marca `revised` no resultado; só a visão usa este estado.
   */
  | 'revised'

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

/**
 * Por que um passo falhou: código estável de quem lançou (`DeliveryError`, `FlowError`, fim da
 * execução, ação, extrator...) e a mensagem pt-BR. A tela de problema decide pelo código.
 */
export interface StepFailure {
  code: string
  message: string
}

export interface FlowStepView {
  seq: number
  stepId: StepId
  /** Execução do Claude Code (4A), quando o passo é um comando. */
  runId: string | null
  status: FlowStepStatus
  startedAt: string
  endedAt: string | null
  message: string | null
  /** Código da falha (`StepFailure.code`); `null` em passos sem falha e em linhas antigas. */
  code: string | null
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
  /** Gate atual com "Pedir ajustes": voltas usadas e o limite (`null` = sem ajustes). */
  revise: { used: number; max: number } | null
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
  /** Revisão a publicar como `orkio[bot]` (Task 18): o que vai para a PR ao aprovar. */
  review?: ConfirmReview
  /** Aviso em destaque (ex.: a tentativa anterior demorou e pode ter publicado). */
  warning?: string
}

/** Revisão mostrada no gate do `publish_review` (já redigida; aprovar posta exatamente isto). */
export interface ConfirmReview {
  event: PublishReviewEvent
  summary: string
  /** `inDiff: false` = fora do diff da PR: não é publicado. */
  comments: { path: string; line: number; body: string; inDiff: boolean }[]
  pr: { owner: string; repo: string; number: number }
}

/** Fluxo ativo numa tarefa, do jeito que o card e a lista mostram. */
export type TaskFlowActivity = 'running' | 'needs_you'

/** Fluxos do projeto + extratores e ações disponíveis (registrados em código). */
export interface TaskFlowsProject extends ProjectFlows {
  extractors: { id: string; label: string }[]
  actions: { id: string; label: string }[]
  /** Ajustes de entrega do projeto (5C). */
  delivery: DeliverySettings
}

/**
 * Resultado de "Abrir PR". `mode: 'pr'` = push + /alva-flow:pr (a PR sai do fluxo). `mode: 'push'` =
 * só o push (sem task do Backlog.md vinculada): `compareUrl` abre "Criar a PR" no GitHub (o
 * link é montado no main). Em ambos o fluxo começou; o gate do push aparece na conversa.
 */
export interface OpenPrResult {
  /** `false`: nada a enviar e sem alva-flow, então não há fluxo; só o `compareUrl`. */
  started: boolean
  mode: 'pr' | 'push'
  compareUrl: string | null
}

// ---------- Leitura (config e IPC) ----------

const str = (v: unknown): v is string => typeof v === 'string'

export function parseCondition(v: unknown, depth = 0): Condition | null {
  if (!isRecord(v) || depth > 5) return null
  switch (v['type']) {
    case 'step':
      return str(v['step']) && (v['is'] === 'ok' || v['is'] === 'failed' || v['is'] === 'cancelled')
        ? { type: 'step', step: v['step'], is: v['is'] }
        : null
    case 'var': {
      const op = v['op']
      if (!str(v['key']) || (op !== 'eq' && op !== 'neq' && op !== 'exists')) return null
      return { type: 'var', key: v['key'], op, ...(str(v['value']) ? { value: v['value'] } : {}) }
    }
    case 'visits':
      return str(v['step']) && typeof v['lt'] === 'number' && v['lt'] >= 1
        ? { type: 'visits', step: v['step'], lt: Math.floor(v['lt']) }
        : null
    case 'all':
    case 'any': {
      if (!Array.isArray(v['of'])) return null
      const of = v['of'].map((c) => parseCondition(c, depth + 1))
      return of.every((c): c is Condition => c !== null) ? { type: v['type'], of } : null
    }
    default:
      return null
  }
}

export function parseStep(v: unknown): Step | null {
  if (!isRecord(v) || !str(v['id']) || !str(v['name'])) return null
  const base = { id: v['id'], name: v['name'] }
  switch (v['type']) {
    case 'claude_command':
      if (!str(v['command']) || !str(v['args']) || typeof v['timeoutMin'] !== 'number') return null
      return {
        ...base,
        type: 'claude_command',
        command: v['command'],
        args: v['args'],
        ...(str(v['prompt']) ? { prompt: v['prompt'] } : {}),
        ...(v['readOnly'] === true ? { readOnly: true } : {}),
        timeoutMin: v['timeoutMin'],
        ...(isRecord(v['extract']) && str(v['extract']['extractor'])
          ? { extract: { extractor: v['extract']['extractor'] } }
          : {}),
        ...(v['delivery'] === true ? { delivery: true } : {}),
        ...(typeof v['includeBriefing'] === 'boolean'
          ? { includeBriefing: v['includeBriefing'] }
          : {}),
        ...(isModelName(v['model']) ? { model: v['model'] } : {}),
        ...(isEffort(v['effort']) ? { effort: v['effort'] } : {})
      }
    case 'gate': {
      const show = GATE_SHOWS.find((x) => x === v['show'])
      if (!str(v['message']) || !show) return null
      const revise = v['revise']
      return {
        ...base,
        type: 'gate',
        message: v['message'],
        show,
        onReject: str(v['onReject']) ? v['onReject'] : 'stop',
        timeoutMin: typeof v['timeoutMin'] === 'number' ? v['timeoutMin'] : null,
        ...(isRecord(revise) && str(revise['step']) && typeof revise['max'] === 'number'
          ? { revise: { step: revise['step'], max: revise['max'] } }
          : {})
      }
    }
    case 'orkio_action':
      return str(v['action']) ? { ...base, type: 'orkio_action', action: v['action'] } : null
    case 'branch': {
      const when = parseCondition(v['when'])
      if (!when || !str(v['then'])) return null
      return {
        ...base,
        type: 'branch',
        when,
        then: v['then'],
        ...(str(v['else']) ? { else: v['else'] } : {})
      }
    }
    default:
      return null
  }
}

export function parseFlowDef(v: unknown): Flow | null {
  if (!isRecord(v) || !str(v['id']) || !v['id'] || !str(v['name']) || !Array.isArray(v['steps'])) {
    return null
  }
  const steps = v['steps'].map(parseStep)
  if (!steps.every((s): s is Step => s !== null)) return null
  const tags = Array.isArray(v['tags'])
    ? v['tags'].filter((t): t is string => str(t) && /^[a-z0-9_-]{1,20}$/.test(t)).slice(0, 5)
    : []
  return { id: v['id'], name: v['name'], steps, ...(tags.length > 0 ? { tags } : {}) }
}

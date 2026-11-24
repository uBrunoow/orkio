/**
 * Piloto automático da tarefa (puro, sem React): o fluxo visto como o plano de uma sessão do
 * Claude Code. `flowPlan` diz, passo a passo, o que já foi feito, o que está acontecendo e o que vem
 * a seguir (como a lista de tarefas do Claude Code); `flowStepIndex` diz de que passo de que fluxo
 * veio cada execução, para a conversa mostrar quem "mandou" o comando.
 */
import { ALVA_COMMAND_PHASE, alvaCommandOf, alvaWaitsForCi } from '../../../../shared/alva'
import { isProblem, needsYou } from '../../../../shared/flow-run-state'
import { orkioAction } from '../../../../shared/orkio-actions'
import {
  isPromptStep,
  type FlowRunView,
  type FlowStepStatus,
  type Step
} from '../../../../shared/task-flow'
import type { TaskPhaseId } from '../../../../shared/task-phase'
import { stepDetail } from './step-text'

export type PlanState = 'done' | 'current' | 'waiting' | 'failed' | 'skipped' | 'next' | 'unreached'

export interface PlanStep {
  id: string
  name: string
  kind: Exclude<Step['type'], 'branch'>
  /** Comando do catálogo (`null` = pedido em texto, gate ou ação). */
  command: string | null
  /** Ação do Orkio (`null` nos outros tipos). */
  action: string | null
  /** Passo só de leitura (pedido ao Claude Code sem editar). */
  readOnly: boolean
  /** Fase da tarefa em que o passo entra: conhecida, de um comando qualquer, ou `null` (a anterior). */
  phase: PlanPhase | null
  /** Enquanto roda, espera o CI do GitHub (o `/pr` do alva-flow). */
  waitsForCi: boolean
  /** O que o passo faz, curto, para ler: `/alva-flow:spec`, "Sua aprovação", a ação. */
  detail: string
  state: PlanState
  visits: number
}

export type PlanPhase = { id: TaskPhaseId } | { command: string }

/** Passo visível no plano: saltos (`branch`) são decisões internas, não trabalho. */
type VisibleStep = Exclude<Step, { type: 'branch' }>

function visible(steps: readonly Step[]): VisibleStep[] {
  return steps.filter((s): s is VisibleStep => s.type !== 'branch')
}

function phaseOf(step: VisibleStep): PlanPhase | null {
  if (step.type === 'orkio_action') {
    const phase = orkioAction(step.action)?.phase ?? null
    return phase ? { id: phase } : null
  }
  if (step.type !== 'claude_command' || isPromptStep(step) || !step.command) return null
  const alva = alvaCommandOf(step.command)
  if (alva) return { id: ALVA_COMMAND_PHASE[alva] }
  return { command: step.command.slice(step.command.lastIndexOf(':') + 1) }
}

const DONE: ReadonlySet<FlowStepStatus> = new Set(['ok', 'approved'])
const FAILED: ReadonlySet<FlowStepStatus> = new Set([
  'failed',
  'interrupted',
  'cancelled',
  'rejected'
])

/**
 * O plano do fluxo. O passo atual (`currentStep`) é `current` (rodando) ou `waiting` (esperando
 * você); o estado dos demais vem da última vez que rodaram. Passos sem histórico depois do atual são
 * `next`; antes dele (pulados por um salto), `unreached`. Fluxo encerrado: nada fica `next`.
 */
export function flowPlan(run: FlowRunView): PlanStep[] {
  const steps = visible(run.steps)
  const last = new Map<string, FlowStepStatus>()
  const visits = new Map<string, number>()
  for (const h of run.history) {
    last.set(h.stepId, h.status)
    visits.set(h.stepId, (visits.get(h.stepId) ?? 0) + 1)
  }
  const ended = run.status === 'finished' || run.status === 'cancelled'
  const currentIndex = ended ? -1 : steps.findIndex((s) => s.id === run.currentStep)
  return steps.map((step, i) => {
    const status = last.get(step.id)
    let state: PlanState
    if (i === currentIndex) {
      // Problema = "parou aqui"; espera sua (gate, escolha, decisão) = "esperando você"; rodando ou
      // na fila de vaga (começa sozinho) = "agora".
      state =
        status && FAILED.has(status)
          ? 'failed'
          : run.status === 'paused' && isProblem(run.pauseReason)
            ? 'failed'
            : needsYou(run)
              ? 'waiting'
              : 'current'
    } else if (status === undefined) {
      state = ended || (currentIndex >= 0 && i < currentIndex) ? 'unreached' : 'next'
    } else if (DONE.has(status)) {
      state = 'done'
    } else if (status === 'skipped') {
      state = 'skipped'
    } else if (FAILED.has(status)) {
      state = 'failed'
    } else {
      // Rodando/esperando sem ser o atual (não deveria acontecer): conta como o que vem.
      state = 'next'
    }
    const command = step.type === 'claude_command' && !isPromptStep(step) ? step.command : null
    return {
      id: step.id,
      name: step.name,
      kind: step.type,
      command,
      action: step.type === 'orkio_action' ? step.action : null,
      readOnly: step.type === 'claude_command' && step.readOnly === true,
      phase: phaseOf(step),
      waitsForCi:
        step.type === 'claude_command' && command !== null && alvaWaitsForCi(command, step.args),
      detail: stepDetail(step),
      state,
      visits: visits.get(step.id) ?? 0
    }
  })
}

/** "3 de 6 feitos": progresso do plano (passos pulados contam como resolvidos). */
export function planProgress(plan: readonly PlanStep[]): { done: number; total: number } {
  const counted = plan.filter((p) => p.state !== 'unreached')
  return {
    done: counted.filter((p) => p.state === 'done' || p.state === 'skipped').length,
    total: counted.length
  }
}

export interface FlowStepOrigin {
  flowRunId: string
  flowName: string
  stepName: string
  /** Posição do passo no plano (1-based, sem saltos) e o total de passos. */
  position: number
  total: number
  /** Volta do passo (2 = segunda vez que ele rodou). */
  visit: number
  agentName: string | null
}

/** Execução (runId) → passo de fluxo que a disparou. Execuções avulsas não entram. */
export function flowStepIndex(runs: readonly FlowRunView[]): Map<string, FlowStepOrigin> {
  const out = new Map<string, FlowStepOrigin>()
  for (const run of runs) {
    const steps = visible(run.steps)
    const seen = new Map<string, number>()
    for (const h of run.history) {
      const visit = (seen.get(h.stepId) ?? 0) + 1
      seen.set(h.stepId, visit)
      if (!h.runId) continue
      const index = steps.findIndex((s) => s.id === h.stepId)
      out.set(h.runId, {
        flowRunId: run.id,
        flowName: run.flowName,
        stepName: steps[index]?.name ?? h.stepId,
        position: index + 1,
        total: steps.length,
        visit,
        agentName: run.agent?.name ?? null
      })
    }
  }
  return out
}

/**
 * O que acontece depois do gate atual, em frase curta (mostrado junto de Aprovar/Recusar).
 * Aprovar segue para o próximo passo da lista; se ele for um salto, o fluxo decide. Recusar segue o
 * `onReject` do gate: encerra ou volta a um passo.
 */
export function gateOutcomes(run: FlowRunView): { approve: string; reject: string } | null {
  const index = run.steps.findIndex((s) => s.id === run.currentStep)
  const gate = run.steps[index]
  if (!gate || gate.type !== 'gate') return null
  const next = run.steps[index + 1]
  const approve = !next
    ? 'Aprovar encerra o fluxo.'
    : next.type === 'branch'
      ? 'Aprovar segue o fluxo (ele decide o próximo passo pelas condições).'
      : `Aprovar segue para “${next.name}”.`
  const back = gate.onReject === 'stop' ? null : run.steps.find((s) => s.id === gate.onReject)
  const reject = back ? `Recusar volta para “${back.name}”.` : 'Recusar encerra o fluxo.'
  return { approve, reject }
}

/**
 * Execução do Claude Code cujo resultado o gate atual mostra (`show: 'result'`): a mais recente
 * do fluxo antes do gate. `null` = nenhuma (o gate fica só com a mensagem).
 */
export function gateResultRunId(run: FlowRunView): string | null {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const runId = run.history[i]!.runId
    if (runId) return runId
  }
  return null
}

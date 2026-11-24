/**
 * Fases da tarefa (barra do topo da tela da tarefa): os passos do fluxo agrupados pela fase que
 * cada um declara (Spec → Plano → Implementar → Revisão → PR, ou o nome de outro comando); sem
 * fluxo, as colunas do quadro.
 */
import type { BoardStage } from '../../../../shared/board'
import { TASK_PHASE_LABEL, type TaskPhaseId } from '../../../../shared/task-phase'
import type { PlanPhase, PlanStep } from '../task-flows/flow-plan'

/** Marca outros gatilhos do popover do plano (ex.: "Ver plano"), que não contam como clique fora. */
export const PLAN_TRIGGER_ATTR = 'data-flow-plan-trigger'

export type PhaseState = 'done' | 'current' | 'waiting' | 'failed' | 'next'

export interface TaskPhase {
  id: string
  label: string
  /** Fase conhecida (abre a aba certa do painel); `null` = outro comando ou coluna do quadro. */
  phase: TaskPhaseId | null
  state: PhaseState
}

const RANK: Record<PhaseState, number> = { failed: 4, waiting: 3, current: 2, next: 1, done: 0 }

function stepState(state: PlanStep['state']): PhaseState {
  if (state === 'skipped' || state === 'unreached') return 'done'
  return state
}

function merge(states: PhaseState[]): PhaseState {
  if (states.every((s) => s === 'done')) return 'done'
  const top = states.reduce((a, b) => (RANK[b] > RANK[a] ? b : a))
  return top === 'done' ? 'next' : top
}

function phaseKey(p: PlanPhase): { id: string; label: string; phase: TaskPhaseId | null } {
  return 'id' in p
    ? { id: p.id, label: TASK_PHASE_LABEL[p.id], phase: p.id }
    : { id: `command:${p.command}`, label: p.command, phase: null }
}

export function taskPhases(input: {
  plan: readonly PlanStep[] | null
  stages: readonly BoardStage[]
  stageId: string | null
}): TaskPhase[] {
  if (input.plan && input.plan.length > 0) {
    // Cada fase aparece uma vez, na primeira posição; passos posteriores da mesma fase (ex.: /fix
    // e "revisar de novo" depois do /pr) entram nesse grupo; passo sem fase entra no anterior.
    const groups: (ReturnType<typeof phaseKey> & { states: PhaseState[] })[] = []
    let last: (typeof groups)[number] | undefined
    for (const step of input.plan) {
      const state = stepState(step.state)
      if (step.phase === null) {
        last?.states.push(state)
        continue
      }
      const key = phaseKey(step.phase)
      const group = groups.find((g) => g.id === key.id)
      if (group) {
        group.states.push(state)
        last = group
        continue
      }
      last = { ...key, states: [state] }
      groups.push(last)
    }
    if (groups.length > 0) {
      return groups.map((g) => ({
        id: g.id,
        label: g.label,
        phase: g.phase,
        state: merge(g.states)
      }))
    }
  }
  const stages = [...input.stages].sort((a, b) => a.order - b.order)
  const current = stages.findIndex((s) => s.id === input.stageId)
  return stages.map((s, i) => ({
    id: s.id,
    label: s.name,
    phase: null,
    state: current === -1 ? 'next' : i < current ? 'done' : i === current ? 'current' : 'next'
  }))
}

/** A fase de agora: a primeira que espera você, está rodando ou parou. */
export function currentPhase(phases: readonly TaskPhase[]): TaskPhase | null {
  return (
    phases.find((p) => p.state === 'waiting' || p.state === 'current' || p.state === 'failed') ??
    null
  )
}

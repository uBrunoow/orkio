/**
 * Fases da tarefa (barra do topo da tela da tarefa): os passos do fluxo agrupados em fases
 * (Spec → Plano → Implementar → Revisão → PR); sem fluxo, as colunas do quadro.
 */
import { ALVA_COMMAND_PHASE, alvaCommandOf } from '../../../../shared/alva'
import type { BoardStage } from '../../../../shared/board'
import { orkioAction } from '../../../../shared/orkio-actions'
import type { PlanStep } from '../task-flows/flow-plan'

/** Marca outros gatilhos do popover do plano (ex.: "Ver plano"), que não contam como clique fora. */
export const PLAN_TRIGGER_ATTR = 'data-flow-plan-trigger'

export type PhaseState = 'done' | 'current' | 'waiting' | 'failed' | 'next'

export interface TaskPhase {
  id: string
  label: string
  state: PhaseState
}

/** Fase de um passo pelo que ele faz (`PlanStep.detail`); `null` = entra na fase anterior. */
export function phaseLabel(detail: string): string | null {
  if (detail.startsWith('Ação do Orkio: ')) {
    return orkioAction(detail.slice('Ação do Orkio: '.length))?.phase ?? null
  }
  if (!detail.startsWith('/')) return null
  const name = detail.slice(1).split(/\s/)[0] ?? ''
  const alva = alvaCommandOf(name)
  if (alva) return ALVA_COMMAND_PHASE[alva]
  const command = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name
  return command || null
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

export function taskPhases(input: {
  plan: readonly PlanStep[] | null
  stages: readonly BoardStage[]
  stageId: string | null
}): TaskPhase[] {
  if (input.plan && input.plan.length > 0) {
    // Cada rótulo aparece uma vez, na primeira posição; passos posteriores com o mesmo rótulo
    // (ex.: /fix e "revisar de novo" depois do /pr) entram nesse grupo.
    const groups: { label: string; states: PhaseState[] }[] = []
    let last: (typeof groups)[number] | undefined
    for (const step of input.plan) {
      const label = phaseLabel(step.detail)
      const state = stepState(step.state)
      if (label === null) {
        last?.states.push(state)
        continue
      }
      const group = groups.find((g) => g.label === label)
      if (group) {
        group.states.push(state)
        last = group
        continue
      }
      last = { label, states: [state] }
      groups.push(last)
    }
    if (groups.length > 0) {
      return groups.map((g) => ({ id: g.label, label: g.label, state: merge(g.states) }))
    }
  }
  const stages = [...input.stages].sort((a, b) => a.order - b.order)
  const current = stages.findIndex((s) => s.id === input.stageId)
  return stages.map((s, i) => ({
    id: s.id,
    label: s.name,
    state: current === -1 ? 'next' : i < current ? 'done' : i === current ? 'current' : 'next'
  }))
}

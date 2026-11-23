/**
 * Fases da tarefa (barra do topo da tela da tarefa): os passos do fluxo agrupados em fases
 * (Spec → Plano → Implementar → Revisão → PR); sem fluxo, as colunas do quadro.
 */
import type { BoardStage } from '../../../../shared/board'
import type { PlanStep } from '../task-flows/flow-plan'

export type PhaseState = 'done' | 'current' | 'waiting' | 'failed' | 'next'

export interface TaskPhase {
  id: string
  label: string
  state: PhaseState
}

const ALVA: Record<string, string> = {
  spec: 'Spec',
  plan: 'Plano',
  implement: 'Implementar',
  review: 'Revisão',
  fix: 'Revisão',
  commit: 'PR',
  pr: 'PR'
}

const DELIVERY_ACTIONS = new Set(['push', 'verify_pushed', 'request_review'])

/** Fase de um passo pelo que ele faz (`PlanStep.detail`); `null` = entra na fase anterior. */
export function phaseLabel(detail: string): string | null {
  if (detail.startsWith('Ação do Orkio: ')) {
    return DELIVERY_ACTIONS.has(detail.slice('Ação do Orkio: '.length)) ? 'PR' : null
  }
  if (!detail.startsWith('/')) return null
  const name = detail.slice(1).split(/\s/)[0] ?? ''
  const command = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name
  if (name.startsWith('alva-flow:') && ALVA[command]) return ALVA[command]
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
    const groups: { label: string; states: PhaseState[] }[] = []
    for (const step of input.plan) {
      const label = phaseLabel(step.detail)
      const last = groups.at(-1)
      if (label === null || (last && last.label === label)) {
        if (last) last.states.push(stepState(step.state))
        continue
      }
      groups.push({ label, states: [stepState(step.state)] })
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

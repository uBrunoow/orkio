import type { AgentRunView, RunLogEvent } from '../../../../shared/agent-run'

export interface SessionTotals {
  /** Execuções do Claude Code da tarefa (as que o Orkio guarda, até 10). */
  runs: number
  /** Soma do custo conhecido; `null` se nenhuma execução tem custo. */
  costUsd: number | null
  /** Soma do tempo das execuções terminadas (ms). */
  workMs: number
}

/** Totais da tarefa para o painel Contexto (só o que o Orkio já guarda por execução). */
export function sessionTotals(runs: readonly AgentRunView[]): SessionTotals {
  let cost: number | null = null
  let workMs = 0
  for (const r of runs) {
    if (r.costUsd !== null) cost = (cost ?? 0) + r.costUsd
    if (r.endedAt) {
      const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt)
      if (Number.isFinite(ms) && ms > 0) workMs += ms
    }
  }
  return { runs: runs.length, costUsd: cost, workMs }
}

export interface RunActivity {
  model: string | null
  turns: number | null
  durationMs: number | null
  /** Ferramentas chamadas pela conversa principal (as dos subagentes contam à parte). */
  tools: number
  subagents: number
}

/** O que a execução mais recente fez, lido do log dela. */
export function runActivity(log: readonly RunLogEvent[]): RunActivity {
  let model: string | null = null
  let turns: number | null = null
  let durationMs: number | null = null
  let tools = 0
  let subagents = 0
  for (const e of log) {
    if (e.kind === 'init') model = e.model
    else if (e.kind === 'result') {
      turns = e.turns
      durationMs = e.durationMs
    } else if (e.kind === 'tool' && !e.parent) tools += 1
    else if (e.kind === 'subagent') subagents += 1
  }
  return { model, turns, durationMs, tools, subagents }
}

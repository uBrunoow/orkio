/**
 * Fase 5: "a PR acorda o fluxo". O `PrWakeService` confere, a cada `intervalMs`, a PR de cada fluxo
 * parado no passo "Esperar a PR" (`FlowRunner.waitingPr`) pelos sinais em cache (os mesmos que as
 * automações atualizam a cada minuto: nenhuma chamada extra ao GitHub) e decide pelo motor puro
 * (`shared/pr-wake.ts`, com debounce). Também as ações do passo: `wait_pr` (o executor trata) e
 * `move_done` (PR mergeada → coluna Concluída, pelo mesmo caminho das automações).
 */
import { stageWithRole } from '../../shared/board'
import { ORKIO_ACTIONS, type PrWakeEvent } from '../../shared/orkio-actions'
import {
  prWakeDecision,
  PR_WAKE_DEBOUNCE_MS,
  type PrWakeSeen,
  type PrWatch
} from '../../shared/pr-wake'
import type { BoardService } from '../board/board.service'
import type { BoardStore } from '../board/board.store'
import { errorName } from '../errors'
import { FLOW_FAILURES, type FlowRunner, type OrkioAction } from './flow-runner'

export interface PrWakeDeps {
  runner: Pick<FlowRunner, 'waitingPr' | 'wakePr'>
  /** PR da tarefa agora (sinais em cache, sem rede). */
  prWatch(projectId: string, taskId: string): PrWatch | null
  now?: () => number
  debounceMs?: number
  intervalMs?: number
}

export class PrWakeService {
  private readonly seen = new Map<string, PrWakeSeen>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(private readonly deps: PrWakeDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? 30_000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Uma rodada: acorda quem tem novidade (depois do debounce). Devolve os que acordaram. */
  async tick(): Promise<{ flowRunId: string; event: PrWakeEvent }[]> {
    if (this.ticking) return []
    this.ticking = true
    const woke: { flowRunId: string; event: PrWakeEvent }[] = []
    try {
      const waiting = this.deps.runner.waitingPr()
      const alive = new Set(waiting.map((w) => w.flowRunId))
      for (const id of [...this.seen.keys()]) if (!alive.has(id)) this.seen.delete(id)
      const at = (this.deps.now ?? Date.now)()
      for (const w of waiting) {
        let now: PrWatch | null = null
        try {
          now = this.deps.prWatch(w.projectId, w.taskId)
        } catch (error) {
          console.error(`[orkio] PR acorda o fluxo (sinais): ${errorName(error)}`)
          continue
        }
        const d = prWakeDecision({
          baseline: w.baseline,
          now,
          seen: this.seen.get(w.flowRunId) ?? null,
          at,
          debounceMs: this.deps.debounceMs ?? PR_WAKE_DEBOUNCE_MS
        })
        if (d.kind === 'sleep') {
          if (d.seen) this.seen.set(w.flowRunId, d.seen)
          else this.seen.delete(w.flowRunId)
          continue
        }
        this.seen.delete(w.flowRunId)
        try {
          if (await this.deps.runner.wakePr(w.flowRunId, d.event)) {
            woke.push({ flowRunId: w.flowRunId, event: d.event })
          }
        } catch (error) {
          console.error(`[orkio] PR acorda o fluxo: ${errorName(error)}`)
        }
      }
    } finally {
      this.ticking = false
    }
    return woke
  }
}

/** O executor trata `wait_pr` antes de procurar a ação; esta só existe para o catálogo. */
export const WAIT_PR_ACTION: OrkioAction = {
  ...ORKIO_ACTIONS.wait_pr,
  run: async () => ({
    ok: false,
    code: FLOW_FAILURES.actionFailed,
    message: 'A espera da PR é feita pelo executor dos fluxos.'
  })
}

/** `move_done`: a tarefa vai para a coluna de papel `done` (idempotente). */
export function createMoveDoneAction(deps: {
  store: Pick<BoardStore, 'state' | 'transaction'>
  board: Pick<BoardService, 'applyAutomationMove' | 'flushWrites'>
  stages(projectId: string): readonly { id: string; name: string; role?: string | undefined }[]
}): OrkioAction {
  return {
    ...ORKIO_ACTIONS.move_done,
    run: async ({ projectId, taskId }) => {
      const stages = deps.stages(projectId)
      const doneId = stageWithRole(stages as Parameters<typeof stageWithRole>[0], 'done')
      if (!doneId) return { ok: true, message: 'O quadro não tem coluna Concluída: nada a mover.' }
      const name = stages.find((s) => s.id === doneId)?.name ?? 'Concluída'
      if (deps.store.state(taskId)?.stageId === doneId) {
        return { ok: true, message: `A tarefa já estava em ${name}.` }
      }
      const moved = deps.store.transaction((tx) =>
        deps.board.applyAutomationMove(tx, projectId, taskId, doneId, {
          key: `flow:pr_merged:${taskId}:${doneId}`,
          detail: { flow: 'pr_merged' }
        })
      )
      if (moved) deps.board.flushWrites()
      return { ok: true, message: `A tarefa foi para ${name}.` }
    }
  }
}

import type { Result } from '../../shared/result'
import type { TaskEventDetailInput } from '../../shared/task-events'
import type { StepFailure } from '../../shared/task-flow'
import type { TaskPullRequest, TaskSignalsResult } from '../../shared/task-signals'
import type { BoardStore } from '../board/board.store'

export const SIGNALS_FAILURE: StepFailure = {
  code: 'signals',
  message: 'Não deu para conferir a PR no GitHub agora. Tente de novo em instantes.'
}

export type SignalsFetch = (projectId: string, force: boolean) => Promise<Result<TaskSignalsResult>>

/**
 * PR aberta (ou rascunho) da tarefa, lida agora (sinais da 2D com `force`). `pr: null` = sem PR
 * aberta; `failure` = não deu para ler.
 */
export async function openPullFor(
  signals: SignalsFetch,
  projectId: string,
  taskId: string
): Promise<{ pr: TaskPullRequest | null } | { failure: StepFailure }> {
  const r = await signals(projectId, true)
  if (!r.ok) return { failure: SIGNALS_FAILURE }
  const pr = r.value.signals[taskId]?.pr ?? null
  return { pr: pr && (pr.state === 'open' || pr.state === 'draft') ? pr : null }
}

/** Evento `delivery` de uma ação feita pelo Orkio (não pelo Claude no modo entrega). */
export function deliveryEvent(
  deps: { store: Pick<BoardStore, 'addEvent'>; now?: () => Date },
  ref: { projectId: string; taskId: string },
  detail: Omit<TaskEventDetailInput<'delivery'>, 'by'>
): void {
  deps.store.addEvent({
    taskPageId: ref.taskId,
    projectId: ref.projectId,
    at: (deps.now?.() ?? new Date()).toISOString(),
    kind: 'delivery',
    detail: { by: 'orkio', ...detail }
  })
}

/**
 * Revisão publicada pelo `gh` quando você é o autor da PR: o GitHub não deixa pedir alterações na
 * própria PR, então ela vai como comentário. Para o quadro andar como com o "alterações pedidas"
 * (regra padrão: em Revisando → Revisado, menos bloqueada), o Orkio faz esse movimento aqui.
 */
import { stageWithRole, type BoardStage } from '../../shared/board'
import type { BoardService } from '../board/board.service'
import type { BoardStore } from '../board/board.store'

export interface ReviewSelfDeps {
  store: Pick<BoardStore, 'state' | 'transaction'>
  board: Pick<BoardService, 'applyAutomationMove' | 'flushWrites'>
  stages(projectId: string): readonly BoardStage[]
}

/** Move para a etapa de papel `reviewed` só se a tarefa está na de papel `review` e não bloqueada. */
export function moveToReviewedIfReviewing(
  deps: ReviewSelfDeps,
  projectId: string,
  taskId: string
): boolean {
  const stages = deps.stages(projectId)
  const reviewing = stageWithRole(stages, 'review')
  const reviewed = stageWithRole(stages, 'reviewed')
  const state = deps.store.state(taskId)
  if (!reviewing || !reviewed || !state || state.blocked || state.stageId !== reviewing) {
    return false
  }
  const moved = deps.store.transaction((tx) =>
    deps.board.applyAutomationMove(tx, projectId, taskId, reviewed, {
      key: `flow:review_self:${taskId}:${Date.now()}`,
      detail: { flow: 'review_self' }
    })
  )
  if (moved) deps.board.flushWrites()
  return moved
}

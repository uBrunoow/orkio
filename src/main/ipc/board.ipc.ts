import type { ORKIO_API } from '../../shared/ipc/api'
import type { BoardService } from '../board/board.service'
import type { Impl } from './register'

/** Quadro: o renderer manda só ids (projeto, página do Notion, etapa) e a configuração das etapas. */
export function boardHandlers(
  service: Pick<
    BoardService,
    'get' | 'save' | 'move' | 'setBlocked' | 'history' | 'retryNow' | 'setAutomationPaused'
  >
): Impl<typeof ORKIO_API.board> {
  return {
    get: (projectId, options) => service.get(projectId, options),
    save: (projectId, input) => service.save(projectId, input),
    move: (projectId, taskId, stageId) => service.move(projectId, taskId, stageId),
    setBlocked: (projectId, taskId, blocked) => service.setBlocked(projectId, taskId, blocked),
    history: (projectId, taskId) => service.history(projectId, taskId),
    retryNow: () => service.retryNow(),
    setAutomationPaused: (projectId, taskId, paused) =>
      service.setAutomationPaused(projectId, taskId, paused)
  }
}

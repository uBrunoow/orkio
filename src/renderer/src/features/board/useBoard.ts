import { useCallback } from 'react'
import { patchBoardCard, useSources, type BoardState } from '../../app/sources'
import { ipcCall, ipcResult, useSource } from '../../lib/ipc'
import type { BoardCard, BoardSaveInput, BoardView } from '../../../../shared/board'
import type { Result, ResultError } from '../../../../shared/result'

export type BoardError = ResultError

export interface UseBoard {
  view: BoardView | null
  /** Erro ao carregar (o último quadro carregado continua visível). */
  error: BoardError | null
  loading: boolean
  /** Última recusa do Notion / falha ao mover (some ao fechar). */
  notice: BoardState['notice']
  dismissNotice(): void
  load(force: boolean): Promise<void>
  replace(view: BoardView): void
  move(taskId: string, stageId: string): Promise<void>
  setBlocked(taskId: string, blocked: boolean): Promise<void>
  setAutomationPaused(taskId: string, paused: boolean): Promise<void>
  save(input: BoardSaveInput): Promise<Result<BoardView>>
  retryNow(): Promise<void>
}

/**
 * Quadro de um projeto (`null` = nenhum), compartilhado por todas as telas que o leem (Quadro,
 * tarefa, lista lateral, Configurações, Primeiros passos). Mover/bloquear é otimista: o card muda
 * na hora; o main grava localmente e enfileira a escrita no Notion; o resultado chega por
 * `board.onSyncChanged` (sincronizado, pendente ou recusado → card volta).
 */
export function useBoard(projectId: string | null): UseBoard {
  const { board, projectFlows } = useSources()
  const state = useSource(board, projectId)
  const key = projectId ?? ''

  const replace = useCallback(
    (view: BoardView) => board.set(key, (s) => ({ view, notice: s?.notice ?? null })),
    [board, key]
  )

  const setNotice = useCallback(
    (notice: BoardState['notice']) => board.set(key, (s) => (s ? { ...s, notice } : s)),
    [board, key]
  )

  const mutate = useCallback(
    async (
      taskId: string,
      optimistic: (card: BoardCard) => BoardCard,
      run: () => Promise<Result<BoardCard>>
    ) => {
      const before = board.get(key).value?.view.cards.find((c) => c.taskId === taskId)
      if (!projectId || !before) return
      board.set(key, (s) =>
        patchBoardCard(s, taskId, (card) => ({ ...optimistic(card), sync: { state: 'pending' } }))
      )
      const result = await ipcResult(run)
      if (result.ok) {
        // O evento de sincronização pode já ter chegado: não regride um card já sincronizado.
        board.set(key, (s) =>
          patchBoardCard(s, taskId, (card) =>
            card.sync.state === 'synced' && result.value.sync.state === 'pending'
              ? { ...result.value, sync: card.sync }
              : result.value
          )
        )
      } else {
        board.set(key, (s) => patchBoardCard(s, taskId, () => before))
        setNotice({ ...result.error, taskId })
      }
    },
    [board, key, projectId, setNotice]
  )

  return {
    view: state.value?.view ?? null,
    error: state.error,
    loading: state.loading,
    notice: state.value?.notice ?? null,
    dismissNotice: () => setNotice(null),
    load: (force) => (projectId ? board.reload(projectId, { force }) : Promise.resolve()),
    replace,
    move: (taskId, stageId) =>
      mutate(
        taskId,
        (card) => ({ ...card, stageId }),
        () => window.orkio.board.move(key, taskId, stageId)
      ),
    setBlocked: (taskId, blocked) =>
      mutate(
        taskId,
        (card) => ({ ...card, blocked }),
        () => window.orkio.board.setBlocked(key, taskId, blocked)
      ),
    setAutomationPaused: (taskId, paused) =>
      mutate(
        taskId,
        (card) => ({ ...card, automationPaused: paused }),
        () => window.orkio.board.setAutomationPaused(key, taskId, paused)
      ),
    save: async (input) => {
      const result = await ipcResult(() => window.orkio.board.save(key, input))
      if (result.ok) {
        replace(result.value)
        // Quadro novo ganha as ligações dos fluxos Alva já existentes (e etapas mudam as ligações).
        void projectFlows.reload(key)
      }
      return result
    },
    retryNow: async () => {
      await ipcCall(() => window.orkio.board.retryNow(), undefined)
    }
  }
}

import { useMemo } from 'react'
import { patchBoardCard, useSources, type AppSources, type BoardState } from '../../app/sources'
import { ipcCall, ipcResult, useSource, useSourceMany, type SourceState } from '../../lib/ipc'
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

type BoardControls = Omit<UseBoard, 'view' | 'error' | 'loading' | 'notice'>

/**
 * As ações do quadro de um projeto (`null` = nenhum), sem hooks: tudo grava na chave desse projeto
 * e chama o main com esse id. O Quadro de vários projetos guarda uma por projeto e usa a do card.
 */
export function boardControls(
  sources: Pick<AppSources, 'board' | 'projectFlows'>,
  projectId: string | null
): BoardControls {
  const { board, projectFlows } = sources
  const key = projectId ?? ''

  const replace = (view: BoardView): void =>
    board.set(key, (s) => ({ view, notice: s?.notice ?? null }))

  const setNotice = (notice: BoardState['notice']): void =>
    board.set(key, (s) => (s ? { ...s, notice } : s))

  const mutate = async (
    taskId: string,
    optimistic: (card: BoardCard) => BoardCard,
    run: () => Promise<Result<BoardCard>>
  ): Promise<void> => {
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
  }

  return {
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

/**
 * Quadro de um projeto (`null` = nenhum), compartilhado por todas as telas que o leem (Quadro,
 * tarefa, lista lateral, Configurações, Primeiros passos). Mover/bloquear é otimista: o card muda
 * na hora; o main grava localmente e enfileira a escrita no Notion; o resultado chega por
 * `board.onSyncChanged` (sincronizado, pendente ou recusado → card volta).
 */
export function useBoard(projectId: string | null): UseBoard {
  const { board, projectFlows } = useSources()
  const state = useSource(board, projectId)
  const controls = useMemo(
    () => boardControls({ board, projectFlows }, projectId),
    [board, projectFlows, projectId]
  )
  return {
    view: state.value?.view ?? null,
    error: state.error,
    loading: state.loading,
    notice: state.value?.notice ?? null,
    ...controls
  }
}

export interface ProjectBoard {
  projectId: string
  state: SourceState<BoardState>
  controls: BoardControls
}

/** Quadros de vários projetos, na ordem de `projectIds`, cada um com as ações do próprio projeto. */
export function useBoards(projectIds: readonly string[]): ProjectBoard[] {
  const { board, projectFlows } = useSources()
  const states = useSourceMany(board, projectIds)
  const joined = projectIds.join('\u0000')
  const controls = useMemo(
    () =>
      (joined === '' ? [] : joined.split('\u0000')).map((projectId) => ({
        projectId,
        controls: boardControls({ board, projectFlows }, projectId)
      })),
    [board, projectFlows, joined]
  )
  return useMemo(
    () =>
      controls.map(({ projectId, controls: c }, i) => ({
        projectId,
        state: states[i] ?? { value: null, error: null, loading: true },
        controls: c
      })),
    [controls, states]
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardCard, BoardSaveInput, BoardView } from '../../../../shared/board'
import type { Result } from '../../../../shared/result'

export type BoardError = Extract<Result<never>, { ok: false }>['error']

const IPC_FAILURE: BoardError = {
  code: 'ipc',
  message: 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'
}

async function call<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn()
  } catch {
    return { ok: false, error: IPC_FAILURE }
  }
}

export interface UseBoard {
  view: BoardView | null
  /** Erro ao carregar (o último quadro carregado continua visível). */
  error: BoardError | null
  loading: boolean
  /** Última recusa do Notion / falha ao mover (some ao fechar). */
  notice: (BoardError & { taskId?: string }) | null
  dismissNotice(): void
  load(force: boolean): Promise<void>
  /** Troca o quadro exibido (ex.: depois de salvar o fluxo). */
  replace(view: BoardView): void
  move(taskId: string, stageId: string): Promise<void>
  setBlocked(taskId: string, blocked: boolean): Promise<void>
  setAutomationPaused(taskId: string, paused: boolean): Promise<void>
  save(input: BoardSaveInput): Promise<Result<BoardView>>
  retryNow(): Promise<void>
}

/**
 * Estado do quadro de um projeto. Mover/bloquear é otimista: o card muda na hora; o main grava
 * localmente e enfileira a escrita no Notion; o resultado chega por `board.onSyncChanged`
 * (sincronizado, pendente ou recusado → card volta).
 */
export function useBoard(projectId: string): UseBoard {
  const [view, setView] = useState<BoardView | null>(null)
  const [error, setError] = useState<BoardError | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<UseBoard['notice']>(null)
  const mounted = useRef(true)

  const patchCard = useCallback((taskId: string, patch: (card: BoardCard) => BoardCard) => {
    setView((current) => {
      if (!current) return current
      const cards = current.cards.map((c) => (c.taskId === taskId ? patch(c) : c))
      return {
        ...current,
        cards,
        pendingCount: cards.filter((c) => c.sync.state === 'pending').length
      }
    })
  }, [])

  const apply = useCallback((result: Result<BoardView>) => {
    if (!mounted.current) return
    setLoading(false)
    if (result.ok) {
      setView(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [])

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true)
      apply(await call(() => window.orkio.board.get(projectId, { force })))
    },
    [projectId, apply]
  )

  useEffect(() => {
    mounted.current = true
    void call(() => window.orkio.board.get(projectId, { force: false })).then(apply)
    const unsubscribe = window.orkio.board.onSyncChanged((event) => {
      if (event.projectId !== projectId) return
      patchCard(event.taskId, (card) => ({
        ...card,
        stageId: event.stageId,
        blocked: event.blocked,
        sync:
          event.state === 'pending'
            ? { state: 'pending', ...(event.message ? { message: event.message } : {}) }
            : { state: event.state === 'failed' ? 'failed' : 'synced' }
      }))
      if (event.state === 'failed') {
        setNotice({
          code: 'rejected',
          message: event.message ?? 'O Notion recusou a mudança.',
          taskId: event.taskId,
          ...(event.canReconnect ? { canReconnect: true } : {})
        })
      }
    })
    // Movimento por automação (3B): recarrega o quadro (sem forçar o Notion).
    const unsubscribeChanged = window.orkio.board.onChanged((event) => {
      if (event.projectId !== projectId) return
      void call(() => window.orkio.board.get(projectId, { force: false })).then(apply)
    })
    return () => {
      mounted.current = false
      unsubscribe()
      unsubscribeChanged()
    }
  }, [projectId, apply, patchCard])

  const mutate = useCallback(
    async (
      taskId: string,
      optimistic: (card: BoardCard) => BoardCard,
      run: () => Promise<Result<BoardCard>>
    ) => {
      const before = view?.cards.find((c) => c.taskId === taskId)
      if (!before) return
      patchCard(taskId, (card) => ({ ...optimistic(card), sync: { state: 'pending' } }))
      const result = await call(run)
      if (!mounted.current) return
      if (result.ok) {
        // O evento de sincronização pode já ter chegado: não regride um card já sincronizado.
        patchCard(taskId, (card) =>
          card.sync.state === 'synced' && result.value.sync.state === 'pending'
            ? { ...result.value, sync: card.sync }
            : result.value
        )
      } else {
        patchCard(taskId, () => before)
        setNotice({ ...result.error, taskId })
      }
    },
    [view, patchCard]
  )

  const move = useCallback(
    (taskId: string, stageId: string) =>
      mutate(
        taskId,
        (card) => ({ ...card, stageId }),
        () => window.orkio.board.move(projectId, taskId, stageId)
      ),
    [mutate, projectId]
  )

  const setBlocked = useCallback(
    (taskId: string, blocked: boolean) =>
      mutate(
        taskId,
        (card) => ({ ...card, blocked }),
        () => window.orkio.board.setBlocked(projectId, taskId, blocked)
      ),
    [mutate, projectId]
  )

  const setAutomationPaused = useCallback(
    (taskId: string, paused: boolean) =>
      mutate(
        taskId,
        (card) => ({ ...card, automationPaused: paused }),
        () => window.orkio.board.setAutomationPaused(projectId, taskId, paused)
      ),
    [mutate, projectId]
  )

  const save = useCallback(
    async (input: BoardSaveInput) => {
      const result = await call(() => window.orkio.board.save(projectId, input))
      if (result.ok && mounted.current) {
        setView(result.value)
        setError(null)
      }
      return result
    },
    [projectId]
  )

  const retryNow = useCallback(async () => {
    await window.orkio.board.retryNow().catch(() => {})
  }, [])

  return {
    view,
    error,
    loading,
    notice,
    dismissNotice: () => setNotice(null),
    load,
    replace: (next: BoardView) => {
      setView(next)
      setError(null)
    },
    move,
    setBlocked,
    setAutomationPaused,
    save,
    retryNow
  }
}

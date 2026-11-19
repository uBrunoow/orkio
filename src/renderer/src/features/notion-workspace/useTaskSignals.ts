import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotionResult, TaskSignalsResult } from '../../../../shared/ipc-contract'

type SignalsError = Extract<NotionResult<never>, { ok: false }>['error']

/** Atualização automática leve (o main usa ETag: quase sempre 304). */
export const SIGNALS_POLL_MS = 60_000

export interface UseTaskSignals {
  result: TaskSignalsResult | null
  error: SignalsError | null
  loading: boolean
  refresh(force: boolean): Promise<void>
}

/**
 * Sinais (branch/PR) das tarefas de um projeto. Atualiza a cada 60 s enquanto montado e com a
 * janela visível e em foco, e quando a branch atual do projeto muda.
 */
export function useTaskSignals(projectId: string): UseTaskSignals {
  const [result, setResult] = useState<TaskSignalsResult | null>(null)
  const [error, setError] = useState<SignalsError | null>(null)
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef(false)

  const refresh = useCallback(
    async (force: boolean) => {
      if (inFlight.current && !force) return
      inFlight.current = true
      setLoading(true)
      let next: NotionResult<TaskSignalsResult>
      try {
        next = await window.orkio.signals.get(projectId, { force })
      } catch {
        next = {
          ok: false,
          error: {
            code: 'ipc',
            message: 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'
          }
        }
      }
      inFlight.current = false
      if (!mounted.current) return
      setLoading(false)
      if (next.ok) {
        setResult(next.value)
        setError(null)
      } else {
        setError(next.error)
      }
    },
    [projectId]
  )

  useEffect(() => {
    mounted.current = true
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) void refresh(false)
    }, SIGNALS_POLL_MS)
    const unsubscribe = window.orkio.projects.onBranchChanged((event) => {
      if (event.projectId === projectId) void refresh(false)
    })
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [projectId, refresh])

  return { result, error, loading, refresh }
}

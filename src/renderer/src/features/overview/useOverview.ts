import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverviewSnapshot } from '../../../../shared/overview'
import type { Result } from '../../../../shared/result'

/** Relê a visão (só dados locais) a cada minuto com a janela visível: PRs e saúde mudam sozinhos. */
const RELOAD_MS = 60_000

export interface OverviewState {
  snapshot: OverviewSnapshot | null
  error: string | null
  loading: boolean
  refreshing: boolean
  /** "Atualizar": ciclo das automações (git/GitHub/Notion) e visão nova. */
  refresh(): Promise<void>
}

export function useOverview(): OverviewState {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)

  const apply = useCallback((result: Result<OverviewSnapshot> | null) => {
    if (!alive.current) return
    if (result?.ok) {
      setSnapshot(result.value)
      setError(null)
    } else {
      setError(result?.error.message ?? 'Não foi possível montar a Visão geral. Tente atualizar.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    alive.current = true
    const load = (): void => {
      void window.orkio.overview
        .get()
        .catch(() => null)
        .then(apply)
    }
    load()
    const off = window.orkio.overview.onChanged(load)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, RELOAD_MS)
    return () => {
      alive.current = false
      off()
      clearInterval(timer)
    }
  }, [apply])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await window.orkio.overview.refresh()
      if (!alive.current) return
      if (result.ok) {
        setSnapshot(result.value)
        setError(null)
      } else setError(result.error.message)
    } catch {
      if (alive.current) setError('Não foi possível atualizar. Tente de novo.')
    } finally {
      if (alive.current) setRefreshing(false)
    }
  }, [])

  return { snapshot, error, loading, refreshing, refresh }
}

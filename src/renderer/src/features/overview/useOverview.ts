import { useCallback, useRef, useState } from 'react'
import { useSources } from '../../app/sources'
import { ipcResult, useSource } from '../../lib/ipc'
import type { OverviewSnapshot } from '../../../../shared/overview'

export interface OverviewState {
  snapshot: OverviewSnapshot | null
  error: string | null
  loading: boolean
  refreshing: boolean
  /** "Atualizar": ciclo das automações (git/GitHub/Notion) e visão nova. */
  refresh(): Promise<void>
}

/** Visão geral (só dados locais), uma para o App: lista lateral, sino, Quadro e Agentes. */
export function useOverview(): OverviewState {
  const { overview } = useSources()
  const state = useSource(overview, '')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const result = await ipcResult(() => window.orkio.overview.refresh())
    if (result.ok) overview.set('', result.value)
    setRefreshError(result.ok ? null : result.error.message)
    if (mounted.current) setRefreshing(false)
  }, [overview])

  return {
    snapshot: state.value,
    error: refreshError ?? state.error?.message ?? null,
    loading: state.loading && state.value === null,
    refreshing,
    refresh
  }
}

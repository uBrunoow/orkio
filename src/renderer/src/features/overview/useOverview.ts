import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverviewResult } from '../../../../shared/ipc-contract'
import type { ActivityGroup, ActivityItem, OverviewSnapshot } from '../../../../shared/overview'

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

  const apply = useCallback((result: OverviewResult<OverviewSnapshot> | null) => {
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

/** Atividade recente com filtro por projeto e tipo e "Mostrar mais". */
export function useActivity(
  projectId: string | null,
  group: ActivityGroup | null,
  /** Muda quando a visão é relida (evento novo pode ter entrado). */
  version: string | null
): {
  items: ActivityItem[] | null
  hasMore: boolean
  loadingMore: boolean
  error: string | null
  loadMore(): void
} {
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.overview
      .activity({ projectId, group, limit: 30 })
      .then((r) => {
        if (!active) return
        if (r.ok) {
          setItems(r.value.items)
          setHasMore(r.value.hasMore)
          setError(null)
        } else setError(r.error.message)
      })
      .catch(() => {
        if (active) setError('Não foi possível ler a atividade.')
      })
    return () => {
      active = false
    }
  }, [projectId, group, version])

  const loadMore = useCallback(() => {
    const last = items?.[items.length - 1]
    if (!last) return
    setLoadingMore(true)
    void window.orkio.overview
      .activity({ projectId, group, beforeId: last.id, limit: 30 })
      .then((r) => {
        if (r.ok) {
          setItems((prev) => [...(prev ?? []), ...r.value.items])
          setHasMore(r.value.hasMore)
        }
      })
      .finally(() => setLoadingMore(false))
  }, [items, projectId, group])

  return { items, hasMore, loadingMore, error, loadMore }
}

/** Total de "Esperando você" para o menu lateral (atualiza com `overview:changed`). */
export function useWaitingCount(enabled: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let active = true
    void window.orkio.overview
      .get()
      .then((r) => {
        if (active && r.ok) setCount(r.value.waiting.length)
      })
      .catch(() => undefined)
    const off = window.orkio.overview.onChanged((e) => setCount(e.waiting))
    return () => {
      active = false
      off()
    }
  }, [enabled])
  return count
}

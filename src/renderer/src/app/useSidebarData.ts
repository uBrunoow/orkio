import { useEffect, useMemo, useState } from 'react'
import type { OverviewSnapshot } from '../../../shared/overview'
import { useOverview } from '../features/overview/useOverview'
import { taskGroups, type TaskGroups } from './task-groups'
import type { BoardView } from '../../../shared/board'

/**
 * Dados da lista lateral: a Visão geral (todos os projetos, só dados locais) e o quadro do projeto
 * atual (tarefas a fazer). Relê o quadro quando uma automação ou movimento o muda.
 */
export function useSidebarData(
  projectId: string | null,
  /** Muda para reler o quadro (a chave do roteador: cada navegação). */
  refreshKey = 0
): {
  groups: TaskGroups | null
  snapshot: OverviewSnapshot | null
  board: BoardView | null
} {
  const { snapshot } = useOverview()
  // Guardados com o projeto: trocar de projeto não mostra o quadro do anterior.
  const [loaded, setLoaded] = useState<{ projectId: string; view: BoardView } | null>(null)
  const board = loaded && loaded.projectId === projectId ? loaded.view : null

  useEffect(() => {
    if (!projectId) return
    let active = true
    const load = (): void => {
      void window.orkio.board
        .get(projectId)
        .then((r) => {
          if (active && r.ok) setLoaded({ projectId, view: r.value })
        })
        .catch(() => undefined)
    }
    load()
    const offBoard = window.orkio.board.onChanged((e) => {
      if (e.projectId === projectId) load()
    })
    const offSync = window.orkio.board.onSyncChanged(() => load())
    return () => {
      active = false
      offBoard()
      offSync()
    }
  }, [projectId, refreshKey])

  const groups = useMemo(
    () => (projectId ? taskGroups({ projectId, snapshot, board }) : null),
    [projectId, snapshot, board]
  )
  return { groups, snapshot, board }
}

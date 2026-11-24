import { useMemo } from 'react'
import type { OverviewSnapshot } from '../../../shared/overview'
import { useOverview } from '../features/overview/useOverview'
import { useBoard } from '../features/board/useBoard'
import { taskGroups, type TaskGroups } from './task-groups'
import type { BoardView } from '../../../shared/board'

export function useSidebarData(projectId: string | null): {
  groups: TaskGroups | null
  snapshot: OverviewSnapshot | null
  board: BoardView | null
} {
  const { snapshot } = useOverview()
  const board = useBoard(projectId).view
  const groups = useMemo(
    () => (projectId ? taskGroups({ projectId, snapshot, board }) : null),
    [projectId, snapshot, board]
  )
  return { groups, snapshot, board }
}

import { activityKey, useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import type { ActivityItem } from '../../../../shared/overview'
import type { ActivityGroup } from '../../../../shared/task-events'

/** Atividade recente do projeto num grupo (fonte compartilhada; relê quando a visão muda). */
export function useProjectActivity(projectId: string, group: ActivityGroup): ActivityItem[] | null {
  const { activity } = useSources()
  return useSource(activity, activityKey(projectId, group)).value
}

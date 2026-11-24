import { useSources } from '../../app/sources'
import { useSource, type SourceState } from '../../lib/ipc'
import type { TaskFlowsProject } from '../../../../shared/task-flow'

/**
 * Fluxos de tarefa, ligações às colunas e entrega do projeto (`null` = nenhum), compartilhados
 * pelas telas. Não há evento do main para isso: quem grava põe o resultado (`set`) ou relê
 * (`reload`), e a tela que abre de novo relê.
 */
export function useProjectFlows(projectId: string | null): SourceState<TaskFlowsProject> & {
  set(value: TaskFlowsProject): void
  reload(): Promise<void>
} {
  const { projectFlows } = useSources()
  const state = useSource(projectFlows, projectId)
  return {
    ...state,
    set: (value) => {
      if (projectId) projectFlows.set(projectId, value)
    },
    reload: () => (projectId ? projectFlows.reload(projectId) : Promise.resolve())
  }
}

import type { AgentRunView } from '../../../../shared/agent-run'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'

/**
 * Execuções da tarefa aberta, para a lista "Sessões" da coluna lateral (fora da tela da tarefa).
 * Relê quando uma execução desta tarefa muda de estado (começou, terminou, ramificou).
 */
export function useTaskSessionList(
  target: { projectId: string; taskId: string } | null
): AgentRunView[] | null {
  const key = target ? `${target.projectId}\n${target.taskId}` : null
  const resource = useIpcResource(
    key,
    async (k) => {
      const [projectId, taskId] = k.split('\n') as [string, string]
      return unwrap(await ipcResult(() => window.orkio.claude.state(projectId, taskId))).runs
    },
    {
      subscribe: (reload, k) => {
        const taskId = k.split('\n')[1]
        return window.orkio.claude.onRunEvent((m) => {
          if (m.taskId === taskId && m.event.kind === 'status') reload()
        })
      }
    }
  )
  return resource.value
}

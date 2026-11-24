import { useCallback } from 'react'
import { useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import type { ResultError } from '../../../../shared/result'
import type { TaskSignalsResult } from '../../../../shared/task-signals'

export interface UseTaskSignals {
  result: TaskSignalsResult | null
  error: ResultError | null
  loading: boolean
  refresh(force: boolean): Promise<void>
}

/**
 * Sinais (branch/PR) das tarefas de um projeto, compartilhados pelas telas que os leem. Atualizam
 * a cada 60 s com a janela visível e em foco e quando a branch atual do projeto muda (a fonte em
 * `app/sources.tsx`). `refresh(false)` junta-se a uma leitura em andamento; `true` força.
 */
export function useTaskSignals(projectId: string | null): UseTaskSignals {
  const { signals } = useSources()
  const state = useSource(signals, projectId)
  const refresh = useCallback(
    (force: boolean) =>
      projectId ? signals.reload(projectId, force ? { force } : undefined) : Promise.resolve(),
    [signals, projectId]
  )
  return { result: state.value, error: state.error, loading: state.loading, refresh }
}

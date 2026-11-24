import { useState } from 'react'
import { IPC_FAILURE_MESSAGE, ipcResult } from '../../lib/ipc'
import type { TaskPullRequest } from '../../../../shared/task-signals'

export interface OpenPrState {
  busy: boolean
  error: string | null
  compareUrl: string | null
  started: boolean
  start(): Promise<void>
  setError(message: string | null): void
}

/**
 * "Abrir PR" (entrega avulsa): inicia o push (com o gate de sempre) e o /alva-flow:pr em modo
 * entrega, sem rodar o fluxo todo de novo. Sem task do Backlog.md vinculada, só o push, e depois o
 * link "Criar a PR no GitHub" (comparação montada no main). Um estado por tarefa (`TaskView`).
 */
export function useOpenPr(projectId: string, taskId: string): OpenPrState {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compareUrl, setCompareUrl] = useState<string | null>(null)
  const [started, setStarted] = useState(true)

  async function start(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await ipcResult(() => window.orkio.taskFlows.openPr(projectId, taskId))
      if (r.ok) {
        setCompareUrl(r.value.compareUrl)
        setStarted(r.value.started)
      } else setError(r.error.message)
    } catch {
      setError(IPC_FAILURE_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, compareUrl, started, start, setError }
}

/** Quando "Abrir PR" vale: sem PR ou com a PR fechada (a mesma regra na aba PR & CI e no Ambiente). */
export function canOpenPr(pr: Pick<TaskPullRequest, 'state'> | null | undefined): boolean {
  return !pr || pr.state === 'closed'
}

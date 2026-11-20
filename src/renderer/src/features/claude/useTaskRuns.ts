import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunLogEvent, TaskRunsState } from '../../../../shared/agent-run'

export interface PendingPermission {
  kind: 'permission'
  requestId: string
  tool: string
  summary: string
  suggestion: string | null
}

export interface PendingQuestion {
  kind: 'question'
  requestId: string
  questions: { question: string; options: string[]; multiSelect: boolean }[]
}

/** Pedidos ainda sem resposta (o último estado de cada `requestId` vence). */
export function pendingRequests(
  log: readonly RunLogEvent[]
): (PendingPermission | PendingQuestion)[] {
  const last = new Map<string, RunLogEvent>()
  for (const e of log) {
    if (e.kind === 'permission' || e.kind === 'question') last.set(e.requestId, e)
  }
  const out: (PendingPermission | PendingQuestion)[] = []
  for (const e of last.values()) {
    if (e.kind === 'permission' && e.state === 'pending') {
      out.push({
        kind: 'permission',
        requestId: e.requestId,
        tool: e.tool,
        summary: e.summary,
        suggestion: e.suggestion ?? null
      })
    } else if (e.kind === 'question' && e.state === 'pending') {
      out.push({ kind: 'question', requestId: e.requestId, questions: e.questions })
    }
  }
  return out
}

/** Execuções da tarefa + log ao vivo da execução selecionada (ativa ou a mais recente). */
export function useTaskRuns(projectId: string, taskId: string) {
  const [state, setState] = useState<TaskRunsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [log, setLog] = useState<RunLogEvent[]>([])
  const selected = useRef<string | null>(null)

  const reload = useCallback(async () => {
    const r = await window.orkio.claude.state(projectId, taskId)
    if (r.ok) {
      setState(r.value)
      setError(null)
    } else {
      setError(r.error.message)
    }
    return r.ok ? r.value : null
  }, [projectId, taskId])

  const select = useCallback(async (runId: string | null) => {
    selected.current = runId
    setSelectedRunId(runId)
    setLog(runId ? await window.orkio.claude.readLog(runId) : [])
  }, [])

  // Carga inicial: seleciona a ativa ou a mais recente.
  useEffect(() => {
    let active = true
    void (async () => {
      const r = await window.orkio.claude.state(projectId, taskId)
      if (!active) return
      if (!r.ok) {
        setError(r.error.message)
        return
      }
      setState(r.value)
      const runId = r.value.activeRunId ?? r.value.runs[0]?.id ?? null
      selected.current = runId
      setSelectedRunId(runId)
      const events = runId ? await window.orkio.claude.readLog(runId) : []
      if (active) setLog(events)
    })()
    return () => {
      active = false
    }
  }, [projectId, taskId])

  // Eventos ao vivo desta tarefa.
  useEffect(
    () =>
      window.orkio.claude.onRunEvent((m) => {
        if (m.taskId !== taskId) return
        // Execução nova na tarefa (ex.: passo de um fluxo): passa a mostrar o log dela.
        const isNew =
          m.runId !== selected.current &&
          m.event.kind === 'status' &&
          (m.event.status === 'queued' || m.event.status === 'running')
        if (selected.current === null || isNew) {
          selected.current = m.runId
          setSelectedRunId(m.runId)
          setLog([m.event])
        } else if (m.runId === selected.current) {
          setLog((prev) => [...prev, m.event])
        }
        if (m.event.kind === 'status') void reload()
      }),
    [taskId, reload]
  )

  return { state, setState, error, selectedRunId, select, log, reload }
}

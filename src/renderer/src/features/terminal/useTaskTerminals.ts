import { useCallback, useState } from 'react'
import type { TaskRunsState } from '../../../../shared/agent-run'
import type { HandoffReturn, HandoffView } from '../../../../shared/handoff'
import type { TaskTerminals, TerminalView } from '../../../../shared/terminal'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'

/** Terminais da tarefa (relidos quando um abre, sai ou fecha). */
export function useTaskTerminals(projectId: string, taskId: string) {
  return useIpcResource<TaskTerminals>(
    `${projectId}:${taskId}`,
    () => window.orkio.terminal.list(projectId, taskId).then(unwrap),
    {
      subscribe: (reload) =>
        window.orkio.terminal.onChanged((e) => {
          if (e.taskId === taskId) reload()
        })
    }
  )
}

/**
 * "Continuar no Claude" da tarefa: o estado (do `claude.state`) e as ações. Relê quando o fluxo ou
 * a sessão da tarefa mudam (o main avisa pelo mesmo evento do fluxo).
 */
export function useHandoff(projectId: string, taskId: string) {
  const state = useIpcResource<TaskRunsState>(
    `${projectId}:${taskId}`,
    () => window.orkio.claude.state(projectId, taskId).then(unwrap),
    {
      subscribe: (reload) => {
        const offFlow = window.orkio.taskFlows.onChanged((e) => {
          if (e.taskId === taskId) reload()
        })
        const offRun = window.orkio.claude.onRunEvent((m) => {
          if (m.taskId === taskId && m.event.kind === 'status') reload()
        })
        return () => {
          offFlow()
          offRun()
        }
      }
    }
  )
  const actions = useHandoffActions(projectId, taskId, state.reload)
  return {
    handoff: state.value?.handoff ?? null,
    hasSession: state.value?.runs.some((r) => r.hasSession) ?? false,
    loading: state.loading,
    ...actions
  }
}

/** As ações (começar, reabrir, devolver), com erro e "ocupado" por ação. */
export function useHandoffActions(
  projectId: string,
  taskId: string,
  after?: () => unknown
): {
  busy: 'start' | 'reopen' | HandoffReturn | null
  error: string | null
  start(): Promise<HandoffView | null>
  reopen(): Promise<HandoffView | null>
  giveBack(mode: HandoffReturn): Promise<boolean>
} {
  const [busy, setBusy] = useState<'start' | 'reopen' | HandoffReturn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async <T>(kind: 'start' | 'reopen' | HandoffReturn, fn: () => Promise<T | null>) => {
      setBusy(kind)
      setError(null)
      try {
        return await fn()
      } finally {
        setBusy(null)
        void after?.()
      }
    },
    [after]
  )
  const start = useCallback(
    () =>
      run('start', async () => {
        const r = await ipcResult(() => window.orkio.claude.continueInClaude(projectId, taskId))
        if (!r.ok) setError(r.error.message)
        return r.ok ? r.value : null
      }),
    [run, projectId, taskId]
  )
  const reopen = useCallback(
    () =>
      run('reopen', async () => {
        const r = await ipcResult(() => window.orkio.claude.reopenHandoff(projectId, taskId))
        if (!r.ok) setError(r.error.message)
        return r.ok ? r.value : null
      }),
    [run, projectId, taskId]
  )
  const giveBack = useCallback(
    async (mode: HandoffReturn) =>
      (await run(mode, async () => {
        const r = await ipcResult(() => window.orkio.claude.giveBack(projectId, taskId, mode))
        if (!r.ok) setError(r.error.message)
        return r.ok ? true : null
      })) === true,
    [run, projectId, taskId]
  )
  return { busy, error, start, reopen, giveBack }
}

/** Terminal a mostrar: o escolhido, senão o Claude com você, senão o último aberto. */
export function pickTerminal(
  terminals: readonly TerminalView[],
  selected: string | null,
  handoff: HandoffView | null
): TerminalView | null {
  const chosen = terminals.find((t) => t.id === selected)
  if (chosen) return chosen
  if (handoff?.terminalId) {
    const claude = terminals.find((t) => t.id === handoff.terminalId)
    if (claude) return claude
  }
  return terminals.findLast((t) => t.state === 'running') ?? terminals.at(-1) ?? null
}

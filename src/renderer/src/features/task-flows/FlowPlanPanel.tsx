import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '../../components/Alert'
import { StatusToken } from '../../components/StatusToken'
import { AutomationIcon } from '../../components/icons'
import { AUTOPILOT_TEXT, AutopilotPlan } from './AutopilotPlan'
import { ipcResult } from '../../lib/ipc'
import { useTaskView } from '../task/task-view'
import { FLOW_RUN_STATUS } from '../../lib/status-text'

export function FlowPlanPanel({ onCancelled }: { onCancelled(): void }): React.JSX.Element | null {
  const { run, plan } = useTaskView().flow
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Fecha o popover só quando o cancelamento deu certo; a falha fica à vista aqui.
  const cancel = async (): Promise<void> => {
    if (!run) return
    setBusy(true)
    setError(null)
    const result = await ipcResult(() => window.orkio.taskFlows.cancel(run.id))
    setBusy(false)
    if (result.ok) onCancelled()
    else setError(result.error.message)
  }
  if (!run) return null
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <AutomationIcon className="text-muted-foreground" />
        <span className="text-sm font-medium">
          {run.flowName}
          {run.agent ? ` · ${run.agent.name}` : ''}
        </span>
        <StatusToken
          tone={FLOW_RUN_STATUS[run.status].tone}
          label={FLOW_RUN_STATUS[run.status].label}
        />
      </div>
      <p className="text-xs text-muted-foreground">{AUTOPILOT_TEXT}</p>
      <AutopilotPlan plan={plan ?? []} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>
          Cancelar fluxo
        </Button>
      </div>
    </>
  )
}

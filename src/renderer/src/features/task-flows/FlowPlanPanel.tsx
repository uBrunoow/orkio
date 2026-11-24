import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '../../components/Alert'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { AutomationIcon } from '../../components/icons'
import type { FlowRunView } from '../../../../shared/task-flow'
import { AutopilotPlan } from './AutopilotPlan'
import { RUN_STATUS } from './run-status'

/**
 * Conteúdo do popover da barra de fases: nome do fluxo (e agente), estado, a frase do piloto
 * automático, o plano e "Cancelar fluxo" (a mesma ação do fim da conversa).
 */
export function FlowPlanPanel({
  run,
  onCancelled
}: {
  run: FlowRunView
  onCancelled(): void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Fecha o popover só quando o cancelamento deu certo; a falha fica à vista aqui.
  const cancel = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.orkio.taskFlows.cancel(run.id)
      if (result.ok) onCancelled()
      else setError(result.error.message)
    } catch {
      setError('Não foi possível cancelar o fluxo. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <AutomationIcon className="text-muted-foreground" />
        <span className="text-sm font-medium">
          {run.flowName}
          {run.agent ? ` · ${run.agent.name}` : ''}
        </span>
        <StatusToken
          tone={toneOf(RUN_STATUS[run.status].color)}
          label={RUN_STATUS[run.status].label}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Piloto automático: o Orkio manda cada passo para o Claude Code e segue sozinho. Ele para
        quando precisar de você.
      </p>
      <AutopilotPlan run={run} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>
          Cancelar fluxo
        </Button>
      </div>
    </>
  )
}

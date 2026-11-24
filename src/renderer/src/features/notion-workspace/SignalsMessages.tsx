import { Alert } from '../../components/Alert'
import { ActionLink } from '../projects/ActionLink'
import type { TaskSignalsResult } from '../../../../shared/task-signals'

/** Avisos dos sinais (sem GitHub, sem acesso, detalhes faltando) com o link sugerido pelo main. */
export function SignalsMessages({
  result
}: {
  result: TaskSignalsResult | null
}): React.JSX.Element | null {
  if (!result || result.messages.length === 0) return null
  return (
    <Alert
      tone="warning"
      {...(result.action ? { action: <ActionLink action={result.action} /> } : {})}
    >
      <div className="flex flex-col gap-1">
        {result.messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
    </Alert>
  )
}

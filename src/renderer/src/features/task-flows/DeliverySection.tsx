import { useState } from 'react'
import { ipcResult } from '../../lib/ipc'
import { useProjectFlows } from './useProjectFlows'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckboxField } from '@/components/form'
import { Alert } from '../../components/Alert'

/**
 * Entrega (5C) do projeto: "Exigir minha aprovação para push". É regra do projeto, não de um
 * fluxo, por isso fica em Etapas e automações (6E). Grava na hora, com histórico de configuração.
 */
export function DeliverySection({ projectId }: { projectId: string }): React.JSX.Element {
  const flows = useProjectFlows(projectId)
  const requireApproval = flows.value?.delivery.requirePushApproval ?? null
  const [saveError, setSaveError] = useState<string | null>(null)
  const error = saveError ?? flows.error?.message ?? null

  return (
    <section aria-label="Entrega" className="flex flex-col gap-3">
      <h2 className="text-base font-medium">Entrega</h2>
      <div className="rounded-xl border border-border-soft bg-card px-4 py-3.5">
        {requireApproval === null ? (
          error ? (
            <Alert tone="danger">{error}</Alert>
          ) : (
            <Skeleton className="h-8" aria-label="Carregando ajustes de entrega" />
          )
        ) : (
          <CheckboxField
            label="Exigir minha aprovação para push"
            description="Antes de cada push da branch da tarefa (pelo Orkio ou pelo Claude Code em modo entrega), o fluxo mostra commits, diff e destino e espera você. A branch padrão (main/master, develop, production, release) nunca recebe push, com ou sem este ajuste."
            checked={requireApproval}
            onChange={(on) =>
              void ipcResult(() =>
                window.orkio.taskFlows.setDelivery(projectId, { requirePushApproval: on })
              ).then((r) => {
                if (r.ok) flows.set(r.value)
                setSaveError(r.ok ? null : r.error.message)
              })
            }
          />
        )}
      </div>
      {requireApproval !== null && error && <Alert tone="danger">{error}</Alert>}
    </section>
  )
}

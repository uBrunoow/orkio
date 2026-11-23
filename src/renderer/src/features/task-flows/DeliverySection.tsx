import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckboxField } from '@/components/form'
import { Alert } from '../../components/Alert'

/**
 * Entrega (5C) do projeto: "Exigir minha aprovação para push". É regra do projeto, não de um
 * fluxo, por isso fica em Etapas e automações (6E). Grava na hora, com histórico de configuração.
 */
export function DeliverySection({ projectId }: { projectId: string }): React.JSX.Element {
  const [requireApproval, setRequireApproval] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.orkio.taskFlows.getProject(projectId).then((r) => {
      if (!active) return
      if (r.ok) setRequireApproval(r.value.delivery.requirePushApproval)
      else setError(r.error.message)
    })
    return () => {
      active = false
    }
  }, [projectId])

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
              void window.orkio.taskFlows
                .setDelivery(projectId, { requirePushApproval: on })
                .then((r) => {
                  if (r.ok) {
                    setRequireApproval(r.value.delivery.requirePushApproval)
                    setError(null)
                  } else setError(r.error.message)
                })
            }
          />
        )}
      </div>
      {requireApproval !== null && error && <Alert tone="danger">{error}</Alert>}
    </section>
  )
}

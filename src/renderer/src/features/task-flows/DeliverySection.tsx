import { useEffect, useState } from 'react'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Heading } from '@astryxdesign/core/Heading'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { VStack } from '@astryxdesign/core/VStack'
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
    <Card role="region" aria-label="Entrega">
      <VStack gap={2}>
        <Heading level={2}>Entrega</Heading>
        {requireApproval === null ? (
          error ? (
            <Alert tone="danger">{error}</Alert>
          ) : (
            <Skeleton height={32} aria-label="Carregando ajustes de entrega" />
          )
        ) : (
          <CheckboxInput
            label="Exigir minha aprovação para push"
            description="Antes de cada push da branch da tarefa (pelo Orkio ou pelo Claude Code em modo entrega), o fluxo mostra commits, diff e destino e espera você. A branch padrão (main/master, develop, production, release) nunca recebe push, com ou sem este ajuste."
            value={requireApproval}
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
        {requireApproval !== null && error && <Alert tone="danger">{error}</Alert>}
      </VStack>
    </Card>
  )
}

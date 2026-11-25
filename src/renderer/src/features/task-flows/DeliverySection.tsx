import { useState } from 'react'
import { ipcResult } from '../../lib/ipc'
import { useProjectFlows } from './useProjectFlows'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingRow, SettingsGroup, SwitchRow } from '../../components/SettingRows'
import { Alert } from '../../components/Alert'

/**
 * Entrega (5C) do projeto: "Exigir minha aprovação para push". É regra do projeto, não de um
 * fluxo, por isso fica em Quadro e automações › Entrega. Grava na hora, com histórico de configuração.
 */
export function DeliverySection({ projectId }: { projectId: string }): React.JSX.Element {
  const flows = useProjectFlows(projectId)
  const requireApproval = flows.value?.delivery.requirePushApproval ?? null
  const [saveError, setSaveError] = useState<string | null>(null)
  const error = saveError ?? flows.error?.message ?? null

  return (
    <SettingsGroup
      title="Entrega"
      description="Regra do projeto, vale para todos os fluxos. Grava na hora."
    >
      {requireApproval === null ? (
        <div className="p-4">
          {error ? (
            <Alert tone="danger">{error}</Alert>
          ) : (
            <Skeleton className="h-8" aria-label="Carregando ajustes de entrega" />
          )}
        </div>
      ) : (
        <SwitchRow
          label="Exigir minha aprovação para push"
          description="Antes de cada push da branch da tarefa, o fluxo mostra commits, diff e destino e espera você."
          help="Vale para o push pelo Orkio e pelo Claude Code em modo entrega."
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
      <SettingRow
        label="Branches protegidas"
        description="Nunca recebem push do Orkio, com ou sem aprovação. Só a branch da tarefa vai."
        stack
      >
        <div className="flex flex-wrap gap-1">
          {[
            'main',
            'master',
            'develop',
            'production',
            'staging',
            'trunk',
            'release*',
            'hotfix'
          ].map((b) => (
            <code
              key={b}
              className="rounded-md border border-border-soft bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
            >
              {b}
            </code>
          ))}
        </div>
      </SettingRow>
      {requireApproval !== null && error && (
        <div className="p-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </SettingsGroup>
  )
}

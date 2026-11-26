import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parsePrBases, prBasesOf, type DeliverySettings } from '../../../../shared/delivery'
import { ipcResult } from '../../lib/ipc'
import { useProjectFlows } from './useProjectFlows'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingRow, SettingsGroup, SwitchRow } from '../../components/SettingRows'
import { Alert } from '../../components/Alert'

/**
 * Entrega (5C) do projeto: "Exigir minha aprovação para push", "Agentes enviam e abrem PR sozinhos"
 * e para onde vão as PRs. É regra do projeto, não de um fluxo, por isso fica em Quadro e
 * automações › Entrega. Grava na hora, com histórico de configuração.
 */
export function DeliverySection({ projectId }: { projectId: string }): React.JSX.Element {
  const flows = useProjectFlows(projectId)
  const delivery = flows.value?.delivery ?? null
  const requireApproval = delivery?.requirePushApproval ?? null
  const [saveError, setSaveError] = useState<string | null>(null)
  const error = saveError ?? flows.error?.message ?? null
  const save = (patch: Partial<DeliverySettings>): void => {
    if (!delivery) return
    void ipcResult(() =>
      window.orkio.taskFlows.setDelivery(projectId, { ...delivery, ...patch })
    ).then((r) => {
      if (r.ok) flows.set(r.value)
      setSaveError(r.ok ? null : r.error.message)
    })
  }

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
          onChange={(on) => save({ requirePushApproval: on })}
        />
      )}
      {delivery && (
        <SwitchRow
          label="Agentes enviam e abrem PR sozinhos"
          description="Qualquer conversa ou passo pode enviar a branch da tarefa e abrir a PR dela, só para as branches de destino abaixo."
          help="Nunca para main ou master. Merge, força e apagar branch continuam com você. Agentes sem entrega no perfil (ex.: Revisor) não enviam."
          checked={delivery.agentsDeliver === true}
          onChange={(on) => save({ agentsDeliver: on })}
        />
      )}
      {delivery?.agentsDeliver && (
        <PrBasesRow
          key={prBasesOf(delivery).join(',')}
          bases={prBasesOf(delivery)}
          onSave={(prBases) => save({ prBases })}
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

/** "PRs só para": branches de destino separadas por vírgula (validadas como no main). */
function PrBasesRow({
  bases,
  onSave
}: {
  bases: string[]
  onSave(bases: string[]): void
}): React.JSX.Element {
  const id = useId()
  const [text, setText] = useState(bases.join(', '))
  const parsed = parsePrBases(text.split(','))
  const changed = parsed.ok && parsed.value.join(',') !== bases.join(',')
  return (
    <SettingRow
      label="PRs só para"
      labelFor={id}
      description={
        parsed.ok ? (
          'Branches de destino, separadas por vírgula. A primeira é a usada por padrão.'
        ) : (
          <span className="text-danger">{parsed.error}</span>
        )
      }
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (parsed.ok) onSave(parsed.value)
        }}
      >
        <Input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 w-44 font-mono text-xs"
          aria-invalid={!parsed.ok}
          maxLength={200}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!changed}>
          Salvar
        </Button>
      </form>
    </SettingRow>
  )
}

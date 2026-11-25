import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/form'
import { isUsableAgent, type AgentsState } from '../../../../shared/agent'
import { PlusIcon, TrashIcon } from '../../components/icons'
import { SettingsGroup } from '../../components/SettingRows'
import { AgentAvatar } from './AgentAvatar'

export function AssignRules({
  state,
  onSave
}: {
  state: AgentsState
  onSave(rules: AgentsState['rules']): Promise<void>
}): React.JSX.Element | null {
  const [rules, setRules] = useState(state.rules)
  const [stageId, setStageId] = useState<string>('')
  const [agentKey, setAgentKey] = useState<string>('')
  const usable = state.agents.filter(isUsableAgent)
  if (state.stages.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Atribuição por coluna</h2>
        <p className="text-xs text-muted-foreground">
          Crie o quadro deste projeto para atribuir tarefas por coluna.
        </p>
      </div>
    )
  }
  const stageName = (id: string): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    state.agents.find((a) => a.key === key)?.profile?.name ?? key
  const free = state.stages.filter((s) => !rules.some((r) => r.stageId === s.id))
  const dirty = JSON.stringify(rules) !== JSON.stringify(state.rules)

  const face = (key: string): React.JSX.Element => {
    const a = state.agents.find((x) => x.key === key)
    return (
      <AgentAvatar
        name={agentName(key)}
        color={a?.profile?.color ?? 'yellow'}
        seed={key}
        size="md"
      />
    )
  }

  return (
    <SettingsGroup
      bare
      title="Atribuição por coluna"
      description="Tarefa sem agente que entra na coluna (à mão ou por automação) fica com o agente escolhido. Se a coluna tem fluxo ao entrar, ele começa com esse agente."
    >
      <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
        {rules.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs text-muted-foreground">
            Nenhuma regra: as tarefas entram nas colunas sem agente.
          </p>
        ) : (
          <ul
            aria-label="Regras de atribuição"
            className="flex flex-col divide-y divide-border-soft"
          >
            {rules.map((r) => (
              <li key={r.stageId} className="flex items-center gap-3 px-4 py-2.5">
                {face(r.agentKey)}
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {`Ao entrar em ${stageName(r.stageId)}, atribuir a ${agentName(r.agentKey)}`}
                </span>
                <Button
                  size="icon-sm"
                  variant="danger"
                  aria-label={`Remover regra de ${stageName(r.stageId)}`}
                  onClick={() => setRules(rules.filter((x) => x.stageId !== r.stageId))}
                >
                  <TrashIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {free.length > 0 && usable.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-soft bg-surface/50 px-4 py-3">
            <SelectField
              className="w-52"
              label="Ao entrar em"
              placeholder="Escolha a coluna"
              options={free.map((s) => ({ value: s.id, label: s.name }))}
              value={stageId || null}
              onChange={(v) => setStageId(v)}
            />
            <SelectField
              className="w-52"
              label="Atribuir a"
              placeholder="Escolha o agente"
              options={usable.map((a) => ({ value: a.key, label: a.profile.name }))}
              value={agentKey || null}
              onChange={(v) => setAgentKey(v)}
            />
            <Button
              variant="outline"
              disabled={!stageId || !agentKey}
              onClick={() => {
                setRules([...rules, { stageId, agentKey }])
                setStageId('')
                setAgentKey('')
              }}
            >
              <PlusIcon />
              Adicionar regra
            </Button>
          </div>
        )}
      </div>
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={() => setRules(state.rules)}>
            Descartar
          </Button>
          <Button onClick={() => void onSave(rules)}>Salvar regras</Button>
        </div>
      )}
    </SettingsGroup>
  )
}

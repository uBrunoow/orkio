import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/form'
import type { AgentsState } from '../../../../shared/agent'
import { TrashIcon } from '../../components/icons'

/** "Tarefas que entram em <etapa> vão para <agente>" (uma por etapa). */
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
  const usable = state.agents.filter(
    (a) => a.profile && a.status !== 'invalid' && a.status !== 'archived'
  )
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

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4">
      <h2 className="text-sm font-medium">Atribuição por coluna</h2>
      <p className="text-xs text-muted-foreground">
        Tarefa sem agente que entra na coluna (à mão ou por automação) fica com o agente escolhido.
        Se a coluna tem fluxo ligado ao entrar, ele começa com esse agente.
      </p>
      {rules.length > 0 && (
        <ul aria-label="Regras de atribuição" className="rounded-lg border border-border-soft">
          {rules.map((r) => (
            <li
              key={r.stageId}
              className="flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                {`Ao entrar em ${stageName(r.stageId)}, atribuir a ${agentName(r.agentKey)}`}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
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
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            className="w-56"
            label="Ao entrar em"
            placeholder="Escolha a coluna"
            options={free.map((s) => ({ value: s.id, label: s.name }))}
            value={stageId || null}
            onChange={(v) => setStageId(v)}
          />
          <SelectField
            className="w-56"
            label="Atribuir a"
            placeholder="Escolha o agente"
            options={usable.map((a) => ({ value: a.key, label: a.profile!.name }))}
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
            Adicionar regra
          </Button>
        </div>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button onClick={() => void onSave(rules)}>Salvar regras</Button>
          <Button variant="ghost" onClick={() => setRules(state.rules)}>
            Descartar
          </Button>
        </div>
      )}
    </div>
  )
}

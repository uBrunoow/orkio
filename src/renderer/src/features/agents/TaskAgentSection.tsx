import { useState } from 'react'
import { SelectField } from '@/components/form'
import type { AgentBadge } from '../../../../shared/agent'
import { Alert } from '../../components/Alert'
import { AgentAvatar } from './AgentAvatar'
import { useAgentsState } from './useAgents'

const NONE = '__nenhum__'

/** Painel da tarefa (8A): quem trabalha nela. A atribuição é local (não vai ao Notion). */
export function TaskAgentSection({
  projectId,
  taskId,
  agent
}: {
  projectId: string
  taskId: string
  agent: AgentBadge | null
}): React.JSX.Element {
  const agents = useAgentsState(projectId).value?.agents ?? null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const usable = (agents ?? []).filter(
    (a) => a.profile && a.status !== 'invalid' && a.status !== 'archived'
  )
  if (agents !== null && usable.length === 0 && !agent) {
    return (
      <p className="text-xs text-muted-foreground">
        Sem agentes neste projeto. Crie um na tela Agentes para atribuir tarefas.
      </p>
    )
  }
  const options = [
    { value: NONE, label: 'Sem agente' },
    ...usable.map((a) => ({ value: a.key, label: a.profile!.name })),
    ...(agent && !usable.some((a) => a.key === agent.key)
      ? [{ value: agent.key, label: agent.name }]
      : [])
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        {agent && (
          <span className="mb-1.5 shrink-0">
            <AgentAvatar name={agent.name} color={agent.color} seed={agent.key} />
          </span>
        )}
        <SelectField
          className="flex-1"
          label="Agente"
          description="Roda os fluxos desta tarefa com as instruções e limites dele."
          options={options}
          value={agent?.key ?? NONE}
          disabled={busy}
          onChange={(value: string) => {
            setBusy(true)
            setError(null)
            void window.orkio.agents
              .assign(projectId, taskId, value === NONE ? null : value)
              .then((r) => {
                if (!r.ok) setError(r.error.message)
              })
              .finally(() => setBusy(false))
          }}
        />
      </div>
      {agent?.problem && <Alert tone="warning">{agent.problem}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  )
}

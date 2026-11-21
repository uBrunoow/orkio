import { useEffect, useState } from 'react'
import { HStack } from '@astryxdesign/core/HStack'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { AgentBadge, AgentView } from '../../../../shared/agent'
import { Alert } from '../../components/Alert'
import { AgentAvatar } from './AgentsPage'

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
  const [agents, setAgents] = useState<AgentView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.orkio.agents.list(projectId).then((r) => {
        if (alive && r.ok) setAgents(r.value.agents)
      })
    }
    load()
    const off = window.orkio.agents.onChanged((e) => {
      if (e.projectId === projectId) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId])

  const usable = (agents ?? []).filter(
    (a) => a.profile && a.status !== 'invalid' && a.status !== 'archived'
  )
  if (agents !== null && usable.length === 0 && !agent) {
    return (
      <Text type="supporting">
        Sem agentes neste projeto. Crie um na tela Agentes para atribuir tarefas.
      </Text>
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
    <VStack gap={2}>
      <HStack gap={2} vAlign="end">
        {agent && <AgentAvatar name={agent.name} color={agent.color} />}
        <Selector
          label="Agente"
          description="Roda os fluxos desta tarefa com as instruções e limites dele."
          options={options}
          value={agent?.key ?? NONE}
          isDisabled={busy}
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
      </HStack>
      {agent?.problem && <Alert tone="warning">{agent.problem}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </VStack>
  )
}

import { useEffect, useState } from 'react'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { AgentsState } from '../../../../shared/agent'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { AssignRules } from './AgentsPage'
import { OrchestratorSection } from './OrchestratorSection'

/**
 * Configurações › Agentes do projeto: o orquestrador (quem puxa tarefas da fila e passa adiante) e
 * as regras de atribuição por coluna. Os perfis ficam na tela Agentes.
 */
export function ProjectAgentsSettings({
  projectId,
  projectName
}: {
  projectId: string
  projectName: string
}): React.JSX.Element {
  const [state, setState] = useState<AgentsState | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.orkio.agents.list(projectId).then((r) => {
        if (!alive) return
        if (r.ok) setState(r.value)
        else setMessage({ tone: 'error', text: r.error.message })
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

  return (
    <VStack gap={5} maxWidth={PAGE_WIDTH.list} role="region" aria-label="Agentes">
      <PageHeader
        title="Agentes do projeto"
        context={projectName}
        subtitle="Quem pega as tarefas do quadro e para quem elas vão a cada coluna."
      />
      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <Text role="status">{message.text}</Text>
        ))}
      {state === null ? (
        <Skeleton height={120} aria-label="Carregando agentes" />
      ) : (
        <>
          {state.stages.length > 0 && <OrchestratorSection projectId={projectId} agents={state} />}
          <AssignRules
            key={JSON.stringify(state.rules)}
            state={state}
            onSave={async (rules) => {
              const r = await window.orkio.agents.setRules(projectId, rules)
              if (r.ok) {
                setState(r.value)
                setMessage({ tone: 'ok', text: 'Regras de atribuição salvas.' })
              } else setMessage({ tone: 'error', text: r.error.message })
            }}
          />
        </>
      )}
    </VStack>
  )
}

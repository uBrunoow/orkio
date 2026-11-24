import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { AssignRules } from './AssignRules'
import { useAgentsState } from './useAgents'
import { OrchestratorSection } from './OrchestratorSection'

/**
 * Configurações › Agentes do projeto: o orquestrador (quem puxa tarefas da fila e passa adiante) e
 * as regras de atribuição por coluna. Os perfis ficam na tela Agentes.
 */
export function ProjectAgentsSettings({ projectId }: { projectId: string }): React.JSX.Element {
  const agents = useAgentsState(projectId)
  const state = agents.value
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const error = message?.tone === 'error' ? message.text : (agents.error?.message ?? null)

  return (
    <section aria-label="Agentes" className={cn('flex flex-col gap-[18px]', PAGE_WIDTH.list)}>
      <PageHeader
        title="Agentes do projeto"
        subtitle="Quem pega as tarefas do quadro e para quem elas vão a cada coluna."
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {message?.tone === 'ok' && (
        <p role="status" className="text-xs text-muted-foreground">
          {message.text}
        </p>
      )}
      {state === null ? (
        <Skeleton className="h-30" aria-label="Carregando agentes" />
      ) : (
        <>
          {state.stages.length > 0 && <OrchestratorSection projectId={projectId} agents={state} />}
          <AssignRules
            key={JSON.stringify(state.rules)}
            state={state}
            onSave={async (rules) => {
              const r = await window.orkio.agents.setRules(projectId, rules)
              if (r.ok) {
                agents.set(r.value)
                setMessage({ tone: 'ok', text: 'Regras de atribuição salvas.' })
              } else setMessage({ tone: 'error', text: r.error.message })
            }}
          />
        </>
      )}
    </section>
  )
}

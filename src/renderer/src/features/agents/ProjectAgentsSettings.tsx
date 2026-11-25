import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { AssignRules } from './AssignRules'
import { useAgentsState } from './useAgents'
import { OrchestratorSection } from './OrchestratorSection'
import { ipcResult } from '../../lib/ipc'
import { plural } from '../../lib/format'
import { isUsableAgent } from '../../../../shared/agent'

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
    <section aria-label="Agentes" className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <div className="flex flex-col gap-2">
        <PageHeader
          title="Agentes do projeto"
          subtitle="Quem pega as tarefas do quadro e para quem elas vão a cada coluna. Os perfis ficam em Agentes."
        />
        {state && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {plural(state.agents.filter(isUsableAgent).length, 'agente pronto', 'agentes prontos')}
            <span aria-hidden="true" className="px-1.5 text-subtle-foreground">
              ·
            </span>
            {plural(state.rules.length, 'regra de atribuição', 'regras de atribuição')}
            <span aria-hidden="true" className="px-1.5 text-subtle-foreground">
              ·
            </span>
            {plural(state.stages.length, 'coluna', 'colunas')} no quadro
          </p>
        )}
      </div>
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
              const r = await ipcResult(() => window.orkio.agents.setRules(projectId, rules))
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

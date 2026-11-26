import { useState } from 'react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { AgentsIcon } from '../../components/icons'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import { plural } from '../../lib/format'
import { CollapsibleHeader } from '../../components/CollapsibleHeader'
import type { SubagentRow, SubagentState } from './run-transcript'
import { RunImages } from './RunImages'
import { StepRow, TOOLS_LIST } from './WorkSteps'

const STATE: Record<SubagentState, { tone: StatusTone; label: string }> = {
  running: { tone: 'running', label: 'Trabalhando' },
  done: { tone: 'success', label: 'Concluído' },
  failed: { tone: 'danger', label: 'Falhou' },
  background: { tone: 'neutral', label: 'Em segundo plano' },
  interrupted: { tone: 'neutral', label: 'Interrompido' }
}

/** Passos mostrados por subagente (os mais recentes); o resto vira "N passos antes". */
const STEPS_SHOWN = 50

/**
 * Cartão dos subagentes que o Claude lançou (ferramenta Task/Agent): título, tipo, ferramentas e
 * estado. Cada um abre a lista do que fez; o que está trabalhando mostra o passo atual.
 */
export function SubagentGroup({
  agents,
  open,
  onToggle
}: {
  agents: readonly SubagentRow[]
  open: boolean
  onToggle(open: boolean): void
}): React.JSX.Element {
  const working = agents.filter((a) => a.state === 'running').length
  const stopped = agents.filter((a) => a.state === 'interrupted').length
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      data-testid="subagent-group"
      className="flex flex-col rounded-lg border border-border-soft bg-surface px-2.5 py-2 text-xs text-muted-foreground"
    >
      <CollapsibleHeader open={open} className="text-xs text-muted-foreground">
        <AgentsIcon className="size-3.5 text-subtle-foreground" />
        <span className="text-foreground">
          {plural(agents.length, 'subagente', 'subagentes')}
          {' · '}
          {working > 0
            ? `${working} trabalhando`
            : stopped > 0
              ? plural(stopped, 'interrompido', 'interrompidos')
              : 'concluídos'}
        </span>
      </CollapsibleHeader>
      <CollapsibleContent>
        <ul aria-label="Subagentes" className="mt-1.5 flex flex-col gap-1.5">
          {agents.map((a) => (
            <SubagentItem key={a.id} agent={a} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SubagentItem({ agent: a }: { agent: SubagentRow }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const st = STATE[a.state]
  const current = a.state === 'running' ? a.steps[a.steps.length - 1] : undefined
  const hidden = Math.max(0, a.steps.length - STEPS_SHOWN)
  return (
    <li className="flex min-w-0 flex-col" data-testid="subagent">
      <Collapsible open={open} onOpenChange={setOpen} className="flex min-w-0 flex-col">
        <CollapsibleHeader open={open} className="min-w-0 gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate text-foreground">{a.title}</span>
          {a.type && (
            <span className="shrink-0 font-mono text-2xs text-subtle-foreground">{a.type}</span>
          )}
          <span className="tabular shrink-0 text-2xs text-subtle-foreground">
            {plural(a.tools, 'ferramenta', 'ferramentas')}
          </span>
          <StatusToken tone={st.tone} label={st.label} className={cn('shrink-0')} />
        </CollapsibleHeader>
        {!open && current && (
          <div
            className="mt-1 ml-5 font-mono text-xs text-muted-foreground"
            data-testid="subagent-current"
          >
            <StepRow step={current} />
          </div>
        )}
        <CollapsibleContent>
          {a.steps.length === 0 ? (
            <p className="mt-1 ml-5 text-2xs text-subtle-foreground">Ainda não usou ferramentas.</p>
          ) : (
            <div
              role="group"
              aria-label={`Passos de ${a.title}`}
              className={cn(TOOLS_LIST, 'font-mono text-xs text-muted-foreground')}
            >
              {hidden > 0 && (
                <p className="font-sans text-2xs text-subtle-foreground">
                  {plural(hidden, 'passo antes', 'passos antes')}
                </p>
              )}
              {a.steps.slice(-STEPS_SHOWN).map((step) => (
                <div key={step.id}>
                  <StepRow step={step} />
                  <RunImages images={step.images} />
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { AgentsIcon } from '../../components/icons'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import { plural } from '../../lib/format'
import { CollapsibleHeader } from '../../components/CollapsibleHeader'
import type { SubagentRow, SubagentState } from './run-transcript'

const STATE: Record<SubagentState, { tone: StatusTone; label: string }> = {
  running: { tone: 'running', label: 'Trabalhando' },
  done: { tone: 'success', label: 'Concluído' },
  failed: { tone: 'danger', label: 'Falhou' },
  background: { tone: 'neutral', label: 'Em segundo plano' },
  interrupted: { tone: 'neutral', label: 'Interrompido' }
}

/** Cartão dos subagentes que o Claude lançou (ferramenta Task/Agent): título, tipo, ferramentas e estado. */
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
          {agents.map((a) => {
            const st = STATE[a.state]
            return (
              <li key={a.id} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-foreground">{a.title}</span>
                {a.type && (
                  <span className="shrink-0 font-mono text-2xs text-subtle-foreground">
                    {a.type}
                  </span>
                )}
                <span className="tabular shrink-0 text-2xs text-subtle-foreground">
                  {plural(a.tools, 'ferramenta', 'ferramentas')}
                </span>
                <StatusToken tone={st.tone} label={st.label} className={cn('shrink-0')} />
              </li>
            )
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

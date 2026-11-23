import { cn } from '@/lib/utils'
import { DoneIcon, ProblemIcon } from '../../components/icons'
import type { PhaseState, TaskPhase } from './task-phases'

const SUFFIX: Record<PhaseState, string> = {
  done: 'feita',
  current: 'agora',
  waiting: 'esperando você',
  failed: 'parou',
  next: 'a seguir'
}

/** Fase em destaque: o tom diz se o agente trabalha (laranja), espera você ou parou. */
const PHASE_CLASS: Record<PhaseState, string> = {
  done: 'text-muted-foreground',
  current: 'bg-brand-tint text-brand-tint-foreground',
  waiting: 'bg-warn-tint text-warn',
  failed: 'bg-danger-tint text-danger',
  next: 'text-subtle-foreground'
}

/** Ponto na fase de agora (laranja), esperando você (amarelo). */
const DOT_CLASS: Partial<Record<PhaseState, string>> = {
  current: 'bg-brand',
  waiting: 'bg-warn'
}

/**
 * Fases da tarefa na barra do topo (Spec → Plano → Implementar → Revisão → PR, ou as colunas):
 * uma caixa só, a fase de agora em destaque, as feitas com ✓ e as próximas apagadas.
 */
export function TaskPhaseBar({
  phases
}: {
  phases: readonly TaskPhase[]
}): React.JSX.Element | null {
  if (phases.length === 0) return null
  return (
    <ul
      role="list"
      aria-label="Fases da tarefa"
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border p-0.5"
    >
      {phases.map((phase) => {
        const dot = DOT_CLASS[phase.state]
        return (
          <li
            key={phase.id}
            role="listitem"
            aria-label={`${phase.label}: ${SUFFIX[phase.state]}`}
            data-phase-state={phase.state}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11.5px] leading-4 whitespace-nowrap',
              PHASE_CLASS[phase.state]
            )}
          >
            {phase.state === 'done' && <DoneIcon className="size-3 text-ok" />}
            {phase.state === 'failed' && <ProblemIcon className="size-3" />}
            {dot && (
              <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot)} />
            )}
            {phase.label}
          </li>
        )
      })}
    </ul>
  )
}

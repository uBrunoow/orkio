import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { ColumnExpandIcon } from '../../components/icons'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import type { PhaseState, TaskPhase } from './task-phases'

const TONE: Record<PhaseState, StatusTone> = {
  done: 'success',
  current: 'running',
  waiting: 'warning',
  failed: 'danger',
  next: 'neutral'
}

const SUFFIX: Record<PhaseState, string> = {
  done: 'feita',
  current: 'agora',
  waiting: 'esperando você',
  failed: 'parou',
  next: 'a seguir'
}

/** Fases da tarefa no topo da tela (Spec → Plano → Implementar → Revisão → PR, ou as colunas). */
export function TaskPhaseBar({
  phases
}: {
  phases: readonly TaskPhase[]
}): React.JSX.Element | null {
  if (phases.length === 0) return null
  return (
    <HStack gap={2} vAlign="center" wrap="wrap" role="list" aria-label="Fases da tarefa">
      {phases.map((phase, i) => (
        <HStack
          key={phase.id}
          gap={2}
          vAlign="center"
          role="listitem"
          aria-label={`${phase.label}: ${SUFFIX[phase.state]}`}
        >
          {i > 0 && <Icon icon={ColumnExpandIcon} size="sm" color="tertiary" />}
          <StatusToken
            tone={TONE[phase.state]}
            label={phase.label}
            data-phase-state={phase.state}
          />
        </HStack>
      ))}
    </HStack>
  )
}

import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { DoneIcon, DotIcon, ProblemIcon } from '../../components/icons'
import type { PhaseState, TaskPhase } from './task-phases'

const SUFFIX: Record<PhaseState, string> = {
  done: 'feita',
  current: 'agora',
  waiting: 'esperando você',
  failed: 'parou',
  next: 'a seguir'
}

/** Fase em destaque: o tom diz se o agente trabalha (laranja), espera você ou parou. */
const ACTIVE: Partial<Record<PhaseState, 'orange' | 'yellow' | 'red'>> = {
  current: 'orange',
  waiting: 'yellow',
  failed: 'red'
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
    <Card padding={0.5}>
      <HStack gap={0.5} vAlign="center" role="list" aria-label="Fases da tarefa">
        {phases.map((phase) => {
          const color = ACTIVE[phase.state]
          return (
            <HStack
              key={phase.id}
              vAlign="center"
              role="listitem"
              aria-label={`${phase.label}: ${SUFFIX[phase.state]}`}
              data-phase-state={phase.state}
            >
              {color ? (
                <Token
                  size="sm"
                  color={color}
                  label={phase.label}
                  icon={<Icon icon={phase.state === 'failed' ? ProblemIcon : DotIcon} size="sm" />}
                />
              ) : (
                <HStack gap={1} vAlign="center" paddingInline={2} paddingBlock={0.5}>
                  {phase.state === 'done' && <Icon icon={DoneIcon} size="sm" color="success" />}
                  <Text type="supporting" color="secondary" className="orkio-mono">
                    {phase.label}
                  </Text>
                </HStack>
              )}
            </HStack>
          )
        })}
      </HStack>
    </Card>
  )
}

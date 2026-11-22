import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { DoneIcon, DotIcon, ProblemIcon, TodoIcon } from '../../components/icons'
import type { Milestone } from './task-progress'

const STATE_TEXT: Record<Milestone['state'], string> = {
  done: 'feito',
  current: 'agora',
  waiting: 'esperando você',
  problem: 'precisa de atenção',
  todo: 'ainda não'
}

/**
 * "Em que pé está": os marcos da tarefa numa linha (Spec, Plano, Código, PR, Revisão, Merge).
 * Feito = ícone verde; atual = ponto laranja (amarelo se espera você); problema = alerta rosa;
 * o resto em cinza. `compact` (painel do Quadro): só o nome, o detalhe vai no nome acessível.
 */
export function TaskProgressStrip({
  milestones,
  compact = false
}: {
  milestones: readonly Milestone[]
  compact?: boolean
}): React.JSX.Element {
  const marks = milestones.map((m) => (
    <VStack
      key={m.key}
      gap={0}
      role="listitem"
      aria-label={`${m.label}: ${STATE_TEXT[m.state]}${m.detail !== '—' ? ` (${m.detail})` : ''}`}
      data-testid={`progress-${m.key}`}
      data-state={m.state}
    >
      <HStack gap={1} vAlign="center">
        {m.state === 'done' ? (
          <Icon icon={DoneIcon} color="success" size="sm" />
        ) : m.state === 'problem' ? (
          <Icon icon={ProblemIcon} color="error" size="sm" />
        ) : m.state === 'current' ? (
          <Icon icon={DotIcon} color="primary" size="sm" />
        ) : m.state === 'waiting' ? (
          <Icon icon={DotIcon} color="warning" size="sm" />
        ) : (
          <Icon icon={TodoIcon} color="tertiary" size="sm" />
        )}
        <Text
          type={compact ? 'supporting' : 'body'}
          weight="medium"
          color={m.state === 'todo' ? 'secondary' : 'primary'}
        >
          {m.label}
        </Text>
      </HStack>
      {!compact && (
        <Text type="supporting" color="secondary" maxLines={1}>
          {m.detail === '—' ? 'ainda não' : m.detail}
        </Text>
      )}
    </VStack>
  ))
  if (compact) {
    return (
      <HStack gap={3} wrap="wrap" role="list" aria-label="Andamento da tarefa">
        {marks}
      </HStack>
    )
  }
  return (
    <Grid columns={milestones.length} gap={3} role="list" aria-label="Andamento da tarefa">
      {marks}
    </Grid>
  )
}

import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { StackItem } from '@astryxdesign/core/Stack'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardCard, BoardStage, TaskSignals } from '../../../../shared/ipc-contract'
import { StatusToken } from '../../components/StatusToken'
import { useTaskFlowState } from '../task-flows/active-flows'
import { useAgentBadge } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentsPage'
import { cardMenuItems, type CardActions } from './BoardCardView'
import { cardStatus } from './card-status'

/**
 * Visão em lista do quadro: uma linha por tarefa, na ordem das etapas. Mesmos dados do Kanban
 * (nada novo no main); sem arrasto, o menu "Mover para…" de cada linha troca a etapa.
 */
export function BoardList({
  stages,
  cards,
  signals,
  selectedTaskId,
  actions
}: {
  stages: readonly BoardStage[]
  cards: readonly BoardCard[]
  signals: Record<string, TaskSignals>
  selectedTaskId: string | null
  actions: CardActions
}): React.JSX.Element {
  const order = new Map(stages.map((s, i) => [s.id, i]))
  const rows = [...cards].sort(
    (a, b) =>
      (order.get(a.stageId ?? '') ?? stages.length) - (order.get(b.stageId ?? '') ?? stages.length)
  )
  return (
    <ScrollableArea label="Tarefas do quadro (rolagem)" height="100%">
      <VStack gap={1} role="list" aria-label="Tarefas do quadro" data-testid="board-list">
        {rows.map((card) => (
          <BoardListRow
            key={card.taskId}
            card={card}
            stages={stages}
            signals={signals[card.taskId]}
            actions={actions}
            isSelected={selectedTaskId === card.taskId}
          />
        ))}
      </VStack>
    </ScrollableArea>
  )
}

function BoardListRow({
  card,
  stages,
  signals,
  actions,
  isSelected
}: {
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  actions: CardActions
  isSelected: boolean
}): React.JSX.Element {
  const flow = useTaskFlowState(card.taskId)
  const agent = useAgentBadge(card.taskId)
  const status = cardStatus(card, flow, signals)
  const stage = stages.find((s) => s.id === card.stageId)
  return (
    <Card
      variant="muted"
      padding={2}
      role="listitem"
      tabIndex={0}
      aria-label={`${card.displayId ?? ''} ${card.title}`.trim()}
      aria-current={isSelected ? 'true' : undefined}
      data-task-id={card.taskId}
      data-sync={card.sync.state}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a, [role="menu"]'))
          actions.onOpen(card.taskId)
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          actions.onOpen(card.taskId)
        }
      }}
    >
      <HStack gap={3} vAlign="center">
        <Code>{card.displayId ?? '—'}</Code>
        <StackItem size="fill">
          <Text weight="semibold" maxLines={1}>
            {card.title}
          </Text>
        </StackItem>
        {agent && <AgentAvatar name={agent.name} color={agent.color} />}
        {status && <StatusToken label={status.label} tone={status.tone} />}
        <Text type="supporting" color="secondary" maxLines={1}>
          {stage?.name ?? 'Sem etapa'}
        </Text>
        <MoreMenu
          label={`Ações de ${card.displayId ?? card.title}`}
          size="sm"
          items={cardMenuItems(card, stages, actions)}
        />
      </HStack>
    </Card>
  )
}

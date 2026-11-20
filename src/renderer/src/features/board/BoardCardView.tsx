import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardCard, BoardStage, TaskSignals } from '../../../../shared/ipc-contract'
import { LockIcon, PauseIcon } from '../../components/icons'
import { useTaskFlowState } from '../task-flows/active-flows'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import { tokenColor } from '../notion-workspace/notion-colors'

export interface CardActions {
  onOpen(taskId: string): void
  onMove(taskId: string, stageId: string): void
  onToggleBlocked(taskId: string, blocked: boolean): void
  onToggleAutomation(taskId: string, paused: boolean): void
}

/** Conteúdo do card (no quadro e no "fantasma" do arrasto). */
export function BoardCardBody({
  card,
  stages,
  signals,
  actions
}: {
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  actions: CardActions | null
}): React.JSX.Element {
  const label = card.displayId ?? card.title
  const flow = useTaskFlowState(card.taskId)
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center">
        <Code data-testid="card-id">{card.displayId ?? '—'}</Code>
        {card.blocked && (
          <HStack vAlign="center" role="img" aria-label="Bloqueada" data-testid="card-blocked">
            <Icon icon={LockIcon} size="sm" color="secondary" />
          </HStack>
        )}
        {card.automationPaused && (
          <HStack
            vAlign="center"
            role="img"
            aria-label="Automações pausadas"
            data-testid="card-automation-paused"
          >
            <Icon icon={PauseIcon} size="sm" color="secondary" />
          </HStack>
        )}
        {card.sync.state === 'pending' && (
          <Token size="sm" color="yellow" label="Sincronizando" data-testid="card-sync" />
        )}
        {flow && (
          <Token
            size="sm"
            color={flow === 'needs_you' ? 'yellow' : 'default'}
            label={flow === 'needs_you' ? 'Esperando você' : 'Fluxo'}
            data-testid="card-flow"
          />
        )}
        <StackItem size="fill">
          {actions && (
            <HStack hAlign="end">
              <MoreMenu
                label={`Ações de ${label}`}
                size="sm"
                items={[
                  { label: 'Abrir detalhes', onClick: () => actions.onOpen(card.taskId) },
                  {
                    label: card.blocked ? 'Desmarcar bloqueada' : 'Marcar como bloqueada',
                    onClick: () => actions.onToggleBlocked(card.taskId, !card.blocked)
                  },
                  {
                    label: card.automationPaused ? 'Retomar automações' : 'Pausar automações',
                    onClick: () => actions.onToggleAutomation(card.taskId, !card.automationPaused)
                  },
                  { type: 'divider' },
                  ...stages
                    .filter((s) => s.id !== card.stageId)
                    .map((s) => ({
                      label: `Mover para ${s.name}`,
                      onClick: () => actions.onMove(card.taskId, s.id)
                    }))
                ]}
              />
            </HStack>
          )}
        </StackItem>
      </HStack>
      <Text weight="semibold">{card.title}</Text>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {card.priority && (
          <Token
            size="sm"
            label={card.priority.name}
            color={tokenColor(card.priority.color)}
            data-testid="card-priority"
          />
        )}
        {card.assignees.length > 0 && <Text type="supporting">{card.assignees.join(', ')}</Text>}
      </HStack>
      <TaskSignalsLine signals={signals} />
    </VStack>
  )
}

export function BoardCardItem({
  card,
  stages,
  signals,
  actions,
  isSelected,
  cardRef,
  onPointerDown
}: {
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  actions: CardActions
  isSelected: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onPointerDown: (e: React.PointerEvent, taskId: string) => void
}): React.JSX.Element {
  return (
    <Card
      ref={cardRef}
      padding={3}
      role="listitem"
      tabIndex={0}
      aria-label={`${card.displayId ?? ''} ${card.title}`.trim()}
      aria-current={isSelected ? 'true' : undefined}
      data-task-id={card.taskId}
      data-sync={card.sync.state}
      style={{ cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
      onPointerDown={(e) => onPointerDown(e, card.taskId)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          actions.onOpen(card.taskId)
        }
      }}
    >
      <BoardCardBody card={card} stages={stages} signals={signals} actions={actions} />
    </Card>
  )
}

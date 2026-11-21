import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { Text } from '@astryxdesign/core/Text'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Button } from '@astryxdesign/core/Button'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardCard, BoardStage, TaskSignals } from '../../../../shared/ipc-contract'
import { GitBranchIcon, LockIcon, PauseIcon, PullRequestIcon } from '../../components/icons'
import { useTaskFlowState } from '../task-flows/active-flows'
import { cardStatus } from './card-status'

export interface CardActions {
  onOpen(taskId: string): void
  onMove(taskId: string, stageId: string): void
  onToggleBlocked(taskId: string, blocked: boolean): void
  onToggleAutomation(taskId: string, paused: boolean): void
  /** Abre a tarefa em tela cheia (Ctrl/Cmd+Enter no card). */
  onExpand?(taskId: string): void
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
  const status = cardStatus(card, flow, signals)
  const branches = signals ? [...new Set([...signals.localBranches, ...signals.remoteBranches])] : []
  const pr = signals?.pr ?? null
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center">
        <Code data-testid="card-id">{card.displayId ?? '—'}</Code>
        <StackItem size="fill">
          <HStack gap={2} vAlign="center" hAlign="end">
            {status && (
              <HStack
                gap={1}
                vAlign="center"
                data-testid={`card-${status.kind === 'pr' ? 'status' : status.kind}`}
              >
                <StatusDot
                  variant={status.tone}
                  label={status.label}
                  isPulsing={status.isPulsing ?? false}
                />
                <Text type="supporting" color={status.tone === 'neutral' ? 'secondary' : 'primary'}>
                  {status.label}
                </Text>
              </HStack>
            )}
            {actions && (
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
            )}
          </HStack>
        </StackItem>
      </HStack>
      <Text weight="semibold">{card.title}</Text>
      <HStack gap={2} vAlign="center" wrap="wrap">
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
        {branches[0] && (
          <HStack gap={1} vAlign="center" data-testid="card-branch">
            <Icon icon={GitBranchIcon} size="sm" color="secondary" />
            <Text type="supporting" color="secondary" maxLines={1}>
              <Code>{branches[0]}</Code>
            </Text>
          </HStack>
        )}
        {pr && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon icon={PullRequestIcon} />}
            label={`#${pr.number}`}
            aria-label={`Abrir a PR #${pr.number} no GitHub`}
            onClick={() => void window.orkio.openExternal(pr.url)}
          />
        )}
        {card.priority && (
          <Text type="supporting" color="secondary" data-testid="card-priority">
            {card.priority.name}
          </Text>
        )}
        {card.assignees.length > 0 && (
          <Text type="supporting" color="secondary">
            {card.assignees.join(', ')}
          </Text>
        )}
      </HStack>
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

import { PrHoverCard } from './PrHoverCard'
import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { BoardCard, BoardStage, TaskSignals } from '../../../../shared/ipc-contract'
import {
  GitBranchIcon,
  LockIcon,
  MoreIcon,
  PauseIcon,
  PullRequestIcon
} from '../../components/icons'
import { useTaskFlowState } from '../task-flows/active-flows'
import { useAgentBadge } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import { StatusToken } from '../../components/StatusToken'
import { cardDetail, cardStatus } from './card-status'
import { useTaskActivity } from './task-activity'

export interface CardActions {
  onOpen(taskId: string): void
  onMove(taskId: string, stageId: string): void
  onToggleBlocked(taskId: string, blocked: boolean): void
  onToggleAutomation(taskId: string, paused: boolean): void
  /** Abre a tarefa em tela cheia (Ctrl/Cmd+Enter no card). */
  onExpand?(taskId: string): void
}

export type CardMenuItem = { label: string; onClick(): void } | { type: 'divider' }

/** Itens do menu "Ações de …" (card do quadro e linha da lista). */
export function cardMenuItems(
  card: BoardCard,
  stages: readonly BoardStage[],
  actions: CardActions
): CardMenuItem[] {
  return [
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
  ]
}

/** Botão "Ações de …" com o menu do card (o mesmo no quadro e na lista). */
export function CardActionsMenu({
  label,
  items,
  className
}: {
  label: string
  items: readonly CardMenuItem[]
  className?: string
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={label}
          className={cn('data-[state=open]:opacity-100', className)}
        >
          <MoreIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {items.map((item, i) =>
          'type' in item ? (
            <DropdownMenuSeparator key={`divider-${i}`} />
          ) : (
            <DropdownMenuItem key={item.label} onSelect={item.onClick}>
              {item.label}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Caixa do card do kanban (mockup `.kc`): também usada no "fantasma" do arrasto. */
export const CARD_CLASS =
  'flex flex-col gap-1.5 rounded-[9px] border border-border-soft bg-card px-[11px] py-2.5'

/** Conteúdo do card (no quadro e no "fantasma" do arrasto): ID · agente · estado, título, metadados. */
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
  const agent = useAgentBadge(card.taskId)
  const status = cardStatus(card, flow, signals)
  const branches = signals
    ? [...new Set([...signals.localBranches, ...signals.remoteBranches])]
    : []
  const pr = signals?.pr ?? null
  const activity = useTaskActivity(card.taskId)
  const detail = cardDetail({ ...activity, pr: null })
  const hasMeta =
    Boolean(detail) ||
    card.blocked ||
    card.automationPaused ||
    Boolean(branches[0]) ||
    Boolean(pr) ||
    Boolean(card.priority) ||
    card.assignees.length > 0
  return (
    <Fragment>
      <div className="flex min-w-0 items-center gap-2 font-mono text-2xs text-subtle-foreground">
        <span data-testid="card-id">{card.displayId ?? '—'}</span>
        {agent && (
          <AgentAvatar name={agent.name} color={agent.color} seed={agent.key} testId="card-agent" />
        )}
        <span className="ml-auto flex min-w-0 items-center gap-1.5 font-sans">
          {status && (
            <StatusToken
              label={status.label}
              tone={status.tone}
              className="min-w-0 text-[11.5px]"
              data-testid={`card-${status.kind === 'pr' ? 'status' : status.kind}`}
            />
          )}
          {actions && (
            <CardActionsMenu
              label={`Ações de ${label}`}
              items={cardMenuItems(card, stages, actions)}
              className="-my-1 -mr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            />
          )}
        </span>
      </div>
      <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">{card.title}</p>
      {hasMeta && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-subtle-foreground">
          {detail && (
            <span className="min-w-0 flex-1 truncate" data-testid="card-detail">
              {detail}
            </span>
          )}
          {card.blocked && (
            <span role="img" aria-label="Bloqueada" data-testid="card-blocked" className="flex">
              <LockIcon className="size-3.5" />
            </span>
          )}
          {card.automationPaused && (
            <span
              role="img"
              aria-label="Automações pausadas"
              data-testid="card-automation-paused"
              className="flex"
            >
              <PauseIcon className="size-3.5" />
            </span>
          )}
          {branches[0] && (
            <span className="flex max-w-full min-w-0 items-center gap-1" data-testid="card-branch">
              <GitBranchIcon className="size-3.5" />
              <code className="min-w-0 truncate font-mono text-2xs">{branches[0]}</code>
            </span>
          )}
          {pr && (
            <PrHoverCard pr={pr}>
              <button
                type="button"
                aria-label={`Abrir a PR #${pr.number} no GitHub`}
                className="-mx-1 flex items-center gap-1 rounded px-1 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => void window.orkio.openExternal(pr.url)}
              >
                <PullRequestIcon className="size-3.5" />
                {cardDetail({ waiting: null, running: null, pr }) ?? `#${pr.number}`}
              </button>
            </PrHoverCard>
          )}
          {card.priority && <span data-testid="card-priority">{card.priority.name}</span>}
          {card.assignees.length > 0 && <span>{card.assignees.join(', ')}</span>}
        </div>
      )}
    </Fragment>
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
    <div
      ref={cardRef}
      role="listitem"
      tabIndex={0}
      aria-label={`${card.displayId ?? ''} ${card.title}`.trim()}
      aria-current={isSelected ? 'true' : undefined}
      data-task-id={card.taskId}
      data-sync={card.sync.state}
      className={cn(
        CARD_CLASS,
        'group shrink-0 cursor-grab touch-none transition-colors outline-none select-none hover:border-border focus-visible:ring-2 focus-visible:ring-ring/40',
        isSelected && 'border-brand'
      )}
      onPointerDown={(e) => onPointerDown(e, card.taskId)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          actions.onOpen(card.taskId)
        }
      }}
    >
      <BoardCardBody card={card} stages={stages} signals={signals} actions={actions} />
    </div>
  )
}

import { PrHoverCard } from '../../components/PrHoverCard'
import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { RUN_MODES, RUN_MODE_TEXT, type RunMode } from '../../../../shared/task-setup'
import { cn } from '@/lib/utils'
import {
  GitBranchIcon,
  LockIcon,
  MoreIcon,
  PauseIcon,
  PullRequestIcon
} from '../../components/icons'
import { useAgentBadge } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import { GitStageToken } from '../../components/GitStageToken'
import { StatusToken } from '../../components/StatusToken'
import { cardSyncStatus, laneBadge, prButtonText } from './card-status'
import type { BoardEntry } from './board-model'
import type { BoardCard, BoardStage } from '../../../../shared/board'
import type { TaskLane } from '../../../../shared/task-lanes'

export interface CardActions {
  onOpen(taskId: string): void
  onMove(taskId: string, stageId: string): void
  onToggleBlocked(taskId: string, blocked: boolean): void
  onToggleAutomation(taskId: string, paused: boolean): void
  /**
   * Fase 1: colunas com "Como deve rodar?" padrão (etapa → modo). Mover para uma delas pergunta
   * como esta tarefa roda (o padrão da coluna ou outro modo só para ela).
   */
  runModes?: Readonly<Record<string, RunMode>>
  onMoveWithMode?(taskId: string, stageId: string, mode: RunMode | null): void
}

export type CardMenuItem =
  | { label: string; onClick(): void }
  | { type: 'divider' }
  | { label: string; sub: { label: string; onClick(): void }[] }

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
      .map((s): CardMenuItem => {
        const mode = actions.runModes?.[s.id]
        const withMode = actions.onMoveWithMode
        if (!mode || !withMode) {
          return { label: `Mover para ${s.name}`, onClick: () => actions.onMove(card.taskId, s.id) }
        }
        return {
          label: `Mover para ${s.name}`,
          sub: [
            {
              label: `Como a coluna manda (${RUN_MODE_TEXT[mode].label})`,
              onClick: () => withMode(card.taskId, s.id, null)
            },
            ...RUN_MODES.filter((m) => m !== mode).map((m) => ({
              label: RUN_MODE_TEXT[m].label,
              onClick: () => withMode(card.taskId, s.id, m)
            }))
          ]
        }
      })
  ]
}

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
          ) : 'sub' in item ? (
            <DropdownMenuSub key={item.label}>
              <DropdownMenuSubTrigger>{item.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-56">
                {item.sub.map((sub) => (
                  <DropdownMenuItem key={sub.label} onSelect={sub.onClick}>
                    {sub.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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

export const CARD_CLASS =
  'flex flex-col gap-1.5 rounded-[9px] border border-border-soft bg-card px-[11px] py-2.5'

/** Raias em que o "o quê" vira a segunda linha do card (o que falta, o que roda, o que se espera). */
const DETAIL_LANES: ReadonlySet<TaskLane> = new Set(['needs_you', 'working', 'waiting'])

export function BoardCardBody({
  entry,
  showProject,
  actions
}: {
  entry: BoardEntry
  showProject: boolean
  actions: CardActions | null
}): React.JSX.Element {
  const { card, stages, signals } = entry
  const label = card.displayId ?? card.title
  const agent = useAgentBadge(card.taskId)
  const badge = laneBadge(entry.personal)
  const sync = cardSyncStatus(card)
  const branches = signals
    ? [...new Set([...signals.localBranches, ...signals.remoteBranches])]
    : []
  const pr = signals?.pr ?? null
  const detail = badge && DETAIL_LANES.has(badge.lane) && badge.what ? badge.what : null
  const hasMeta =
    card.blocked ||
    card.automationPaused ||
    Boolean(branches[0]) ||
    Boolean(pr) ||
    Boolean(card.gitStage) ||
    Boolean(card.priority) ||
    card.assignees.length > 0 ||
    showProject ||
    Boolean(entry.stageName)
  return (
    <Fragment>
      <div className="flex min-w-0 items-center gap-2 font-mono text-2xs text-subtle-foreground">
        <span data-testid="card-id">{card.displayId ?? '—'}</span>
        {agent && (
          <AgentAvatar name={agent.name} color={agent.color} seed={agent.key} testId="card-agent" />
        )}
        <span className="ml-auto flex min-w-0 items-center gap-1.5 font-sans">
          {badge && (
            <span title={badge.what || undefined} data-testid="card-lane" className="flex min-w-0">
              <StatusToken
                label={badge.label}
                tone={badge.tone}
                className="min-w-0 text-[11.5px]"
              />
            </span>
          )}
          {sync && (
            <StatusToken
              label={sync.label}
              tone={sync.tone}
              className="min-w-0 text-[11.5px]"
              data-testid="card-sync"
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
      {detail && (
        <p className="truncate text-[11.5px] text-muted-foreground" data-testid="card-detail">
          {detail}
        </p>
      )}
      {hasMeta && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-subtle-foreground">
          {showProject && (
            <span
              className="max-w-full truncate rounded-full border border-border-soft px-1.5 text-2xs text-muted-foreground"
              data-testid="card-project"
            >
              {entry.projectName}
            </span>
          )}
          {entry.stageName && (
            <span className="min-w-0 truncate" data-testid="card-stage">
              {entry.stageName}
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
          {pr && <PrButton pr={pr} />}
          <GitStageToken stage={card.gitStage} className="max-w-full" />
          {card.priority && <span data-testid="card-priority">{card.priority.name}</span>}
          {card.assignees.length > 0 && <span>{card.assignees.join(', ')}</span>}
        </div>
      )}
    </Fragment>
  )
}

/** Botão "#n" da PR (com os rótulos da PR aberta) que abre no GitHub; cartão da PR no hover. */
export function PrButton({
  pr
}: {
  pr: NonNullable<NonNullable<BoardEntry['signals']>['pr']>
}): React.JSX.Element {
  return (
    <PrHoverCard pr={pr}>
      <button
        type="button"
        aria-label={`Abrir a PR #${pr.number} no GitHub`}
        className="-mx-1 flex min-w-0 items-center gap-1 rounded px-1 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => void window.orkio.openExternal(pr.url)}
      >
        <PullRequestIcon className="size-3.5 shrink-0" />
        <span className="truncate">{prButtonText(pr)}</span>
      </button>
    </PrHoverCard>
  )
}

export function BoardCardItem({
  entry,
  showProject,
  actions,
  cardRef,
  onPointerDown
}: {
  entry: BoardEntry
  showProject: boolean
  actions: CardActions
  cardRef: (el: HTMLDivElement | null) => void
  onPointerDown: (e: React.PointerEvent, key: string) => void
}): React.JSX.Element {
  const { card } = entry
  return (
    <div
      ref={cardRef}
      role="listitem"
      tabIndex={0}
      aria-label={`${card.displayId ?? ''} ${card.title}`.trim()}
      data-task-id={card.taskId}
      data-project-id={entry.projectId}
      data-sync={card.sync.state}
      className={cn(
        CARD_CLASS,
        'group shrink-0 cursor-grab touch-none transition-colors outline-none select-none hover:border-border focus-visible:ring-2 focus-visible:ring-ring/40'
      )}
      onPointerDown={(e) => onPointerDown(e, entry.key)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          actions.onOpen(card.taskId)
        }
      }}
    >
      <BoardCardBody entry={entry} showProject={showProject} actions={actions} />
    </div>
  )
}

import { cn } from '@/lib/utils'
import { StatusToken } from '../../components/StatusToken'
import { useTaskFlowState } from '../task-flows/active-flows'
import { useAgentBadge } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import { CardActionsMenu, cardMenuItems, type CardActions } from './BoardCardView'
import { stageDotClass } from './BoardColumns'
import { cardStatus } from './card-status'
import type { BoardCard, BoardStage } from '../../../../shared/board'
import type { TaskSignals } from '../../../../shared/task-signals'

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
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="overflow-hidden rounded-xl border border-border-soft bg-card">
        <div
          aria-hidden="true"
          className="flex items-center gap-3 border-b border-border-soft px-4 py-2 text-2xs tracking-wider text-subtle-foreground uppercase"
        >
          <span className="w-20 shrink-0">ID</span>
          <span className="min-w-0 flex-1">Tarefa</span>
          <span className="w-40 shrink-0">Estado</span>
          <span className="w-32 shrink-0">Etapa</span>
          <span className="w-6 shrink-0" />
        </div>
        <ul aria-label="Tarefas do quadro" data-testid="board-list">
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
        </ul>
      </div>
    </div>
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
    <li
      tabIndex={0}
      aria-label={`${card.displayId ?? ''} ${card.title}`.trim()}
      aria-current={isSelected ? 'true' : undefined}
      data-task-id={card.taskId}
      data-sync={card.sync.state}
      className={cn(
        'flex cursor-pointer items-center gap-3 border-b border-border-soft px-4 py-2.5 outline-none last:border-b-0 hover:bg-muted focus-visible:bg-muted',
        isSelected && 'bg-muted'
      )}
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
      <code className="w-20 shrink-0 truncate font-mono text-xs text-subtle-foreground">
        {card.displayId ?? '—'}
      </code>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{card.title}</span>
        {agent && <AgentAvatar name={agent.name} color={agent.color} seed={agent.key} />}
      </span>
      <span className="flex w-40 shrink-0 items-center">
        {status && <StatusToken label={status.label} tone={status.tone} className="min-w-0" />}
      </span>
      <span className="flex w-32 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            'size-[7px] shrink-0 rounded-full',
            stage ? stageDotClass(stage) : 'bg-warn'
          )}
        />
        <span className="truncate">{stage?.name ?? 'Sem etapa'}</span>
      </span>
      <CardActionsMenu
        label={`Ações de ${card.displayId ?? card.title}`}
        items={cardMenuItems(card, stages, actions)}
      />
    </li>
  )
}

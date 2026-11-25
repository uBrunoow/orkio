import { cn } from '@/lib/utils'
import { EmptyState } from '../../components/PageState'
import { StatusToken } from '../../components/StatusToken'
import { useAgentBadge } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import { CardActionsMenu, PrButton, cardMenuItems, type CardActions } from './BoardCardView'
import { stageDotClass } from './stage-dot'
import { cardSyncStatus, laneBadge } from './card-status'
import type { BoardColumnDef, BoardEntry, BoardMode } from './board-model'
import { SURFACE } from '../../components/surface'

/**
 * Visão em lista do quadro: as mesmas colunas do Kanban, uma seção por coluna com entradas
 * visíveis e uma linha por tarefa. Sem arrasto: o menu "Mover para…" de cada linha troca a etapa.
 */
export function BoardList({
  mode,
  columns,
  entries,
  actionsFor
}: {
  mode: BoardMode
  columns: readonly BoardColumnDef[]
  /** Entradas visíveis (já filtradas). */
  entries: readonly BoardEntry[]
  actionsFor(projectId: string): CardActions
}): React.JSX.Element {
  const showProject = mode === 'roles'
  const groups = columns
    .map((column) => ({ column, rows: entries.filter((e) => e.columnId === column.id) }))
    .filter((g) => g.rows.length > 0)
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto" data-testid="board-list">
      {groups.length === 0 && <EmptyState title="Nenhuma tarefa com esse filtro" />}
      {groups.map(({ column, rows }) => (
        <section key={column.id} aria-label={column.name} className={SURFACE.list}>
          <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2 text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                'size-[7px] shrink-0 rounded-full',
                column.stage ? stageDotClass(column.stage) : 'bg-warn'
              )}
            />
            <h3 className="text-sm font-normal" title={column.hint}>
              {column.name}
            </h3>
            <span className="tabular text-sm text-subtle-foreground" data-testid="column-count">
              {rows.length}
            </span>
          </div>
          <ul aria-label={`Tarefas em ${column.name}`}>
            {rows.map((entry) => (
              <BoardListRow
                key={entry.key}
                entry={entry}
                showProject={showProject}
                actions={actionsFor(entry.projectId)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function BoardListRow({
  entry,
  showProject,
  actions
}: {
  entry: BoardEntry
  showProject: boolean
  actions: CardActions
}): React.JSX.Element {
  const { card } = entry
  const agent = useAgentBadge(card.taskId)
  const badge = laneBadge(entry.personal)
  const sync = cardSyncStatus(card)
  const pr = entry.signals?.pr ?? null
  return (
    <li
      tabIndex={0}
      aria-label={`${card.displayId ?? ''} ${card.title}`.trim()}
      data-task-id={card.taskId}
      data-project-id={entry.projectId}
      data-sync={card.sync.state}
      className="flex cursor-pointer items-center gap-3 border-b border-border-soft px-4 py-2.5 outline-none last:border-b-0 hover:bg-muted focus-visible:bg-muted"
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
      <span className="flex w-40 shrink-0 items-center gap-2">
        {badge && (
          <span title={badge.what || undefined} data-testid="card-lane" className="flex min-w-0">
            <StatusToken label={badge.label} tone={badge.tone} className="min-w-0" />
          </span>
        )}
        {sync && (
          <StatusToken
            label={sync.label}
            tone={sync.tone}
            className="min-w-0"
            data-testid="card-sync"
          />
        )}
      </span>
      <span className="flex w-44 shrink-0 items-center text-xs text-subtle-foreground">
        {pr && <PrButton pr={pr} />}
      </span>
      {showProject && (
        <span
          className="w-32 shrink-0 truncate text-xs text-muted-foreground"
          data-testid="card-project"
        >
          {entry.projectName}
        </span>
      )}
      {entry.stageName && (
        <span
          className="w-28 shrink-0 truncate text-xs text-muted-foreground"
          data-testid="card-stage"
        >
          {entry.stageName}
        </span>
      )}
      <CardActionsMenu
        label={`Ações de ${card.displayId ?? card.title}`}
        items={cardMenuItems(card, entry.stages, actions)}
      />
    </li>
  )
}

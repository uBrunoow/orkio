import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckboxField } from '@/components/form'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { ScreenTitle } from '../../components/ScreenTitle'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { EmptyState, PageState } from '../../components/PageState'
import { Spinner } from '../../components/Spinner'
import { AutomationIcon, MoreIcon, PauseIcon, RefreshIcon } from '../../components/icons'
import { ColumnSetupsDialog } from '../tasks/ColumnSetupsDialog'
import { BoardFilters } from './BoardFilters'
import {
  BoardNoticeAlert,
  BoardViewControl,
  PendingWritesAlert,
  PriorityFilter
} from './BoardBarParts'
import { AgentBadgesProvider, useAgentBadges, type AgentBadges } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import { BoardColumns } from './BoardColumns'
import { BoardList } from './BoardList'
import { BoardSettings } from './BoardSettings'
import { activityByTask, type TaskActivity } from '../overview/task-activity'
import {
  attentionCount,
  boardEntries,
  boardSelection,
  singleBoardColumns,
  visibleEntries
} from './board-model'
import { BoardProjectPicker } from './BoardProjectPicker'
import { MultiBoard } from './MultiBoard'
import { usePersonalTasks } from './usePersonalTasks'
import { useOverview } from '../overview/useOverview'
import { useBoard } from './useBoard'
import { boardRoute, type BoardLayout, type Route } from '../../app/routes'
import { useSources } from '../../app/sources'
import { ipcCall, ipcResult, unwrap, useIpcResource, useSource } from '../../lib/ipc'
import type { CardActions } from './BoardCardView'
import type { RunMode } from '../../../../shared/task-setup'
import type { AutomationStatus } from '../../../../shared/automation'
import type { ProjectView } from '../../../../shared/projects'
import type { BoardTaskRef } from '../../../../shared/overview'
import { formatTime } from '../../lib/format'
import { ErrorAlert } from '../../components/ErrorAlert'
import { SignalsMessages } from '../notion-workspace/SignalsMessages'

export function BoardPage({
  project,
  linkedProjects,
  route,
  onRoute,
  chooseProject,
  onOpenIntegrations,
  onOpenProjects,
  onOpenBoardSettings,
  onOpenTask
}: {
  /** Projeto atual vinculado ao Notion (null = nenhum). */
  project: ProjectView | null
  /** Projetos vinculados ao Notion (os que o seletor oferece). */
  linkedProjects: readonly ProjectView[]
  route: Extract<Route, { name: 'board' }>
  onRoute(route: Route): void
  /** Troca o projeto atual do app (um projeto escolhido no seletor). */
  chooseProject(id: string): void
  onOpenIntegrations(): void
  onOpenProjects(): void
  onOpenBoardSettings(projectId: string): void
  onOpenTask(ref: BoardTaskRef): void
}): React.JSX.Element {
  const linkedIds = useMemo(() => linkedProjects.map((p) => p.id), [linkedProjects])
  const selection = boardSelection(route, linkedIds, project?.id ?? null)
  const { view, filter } = route
  const keep = { ...(view ? { view } : {}), ...(filter ? { filter } : {}) }
  const openSingle = (id: string): void => {
    chooseProject(id)
    onRoute(boardRoute({ projectId: id, ...keep }))
  }
  const manyIds = selection.kind === 'many' ? selection.projectIds : null
  const chosen = manyIds ? linkedProjects.filter((p) => manyIds.includes(p.id)) : []
  const picker = (
    <BoardProjectPicker
      projects={linkedProjects}
      selection={
        manyIds ?? (selection.kind === 'one' && selection.projectId ? [selection.projectId] : [])
      }
      all={route.projectIds === 'all' && manyIds !== null}
      current={project?.id ?? null}
      onChange={({ projectIds }) => {
        if (projectIds !== 'all' && projectIds.length === 1) openSingle(projectIds[0]!)
        else onRoute(boardRoute({ projectIds, ...keep }))
      }}
    />
  )

  if (manyIds) {
    return (
      <MultiBoard
        route={route}
        projects={chosen}
        picker={picker}
        onRoute={onRoute}
        onOpenTask={onOpenTask}
        onOpenIntegrations={onOpenIntegrations}
        onOpenBoardSettings={onOpenBoardSettings}
        onOpenSingle={openSingle}
      />
    )
  }

  const single =
    selection.kind === 'one' && selection.projectId
      ? (linkedProjects.find((p) => p.id === selection.projectId) ?? project)
      : project
  if (!single) {
    return (
      <div className="flex flex-col gap-5 p-4">
        <ScreenBarStart>
          <ScreenTitle look={5}>Quadro</ScreenTitle>
        </ScreenBarStart>
        <PageState
          kind="empty"
          title="Nenhum projeto vinculado ao Notion"
          description="Vincule um projeto a um projeto do Notion em Projetos para abrir o quadro."
          action={{ label: 'Ir para Projetos', onClick: onOpenProjects }}
        />
      </div>
    )
  }
  return (
    <Board
      projectId={single.id}
      projectName={single.name}
      picker={picker}
      route={route}
      onRoute={onRoute}
      onOpenIntegrations={onOpenIntegrations}
      onOpenBoardSettings={onOpenBoardSettings}
      onOpenTask={(taskId) => onOpenTask({ projectId: single.id, taskId })}
    />
  )
}

function Board({
  projectId,
  projectName,
  picker,
  route,
  onRoute,
  onOpenIntegrations,
  onOpenBoardSettings,
  onOpenTask
}: {
  projectId: string
  projectName: string
  picker: React.ReactNode
  route: Extract<Route, { name: 'board' }>
  onRoute(route: Route): void
  onOpenIntegrations(): void
  onOpenBoardSettings(projectId: string): void
  onOpenTask(taskId: string): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const automation = useAutomationStatus(projectId)
  const signals = useTaskSignals(projectId)
  const refreshSignals = signals.refresh
  const personal = usePersonalTasks()
  const reloadPersonal = personal.reload
  const agentBadges = useAgentBadges(projectId)
  const columnSetups = useIpcResource(projectId, (id) =>
    window.orkio.taskSetup.columns(id).then(unwrap)
  ).value
  const runModes = useMemo(() => {
    const out: Record<string, RunMode> = {}
    for (const s of columnSetups?.stages ?? []) if (s.setup.mode) out[s.id] = s.setup.mode
    return out
  }, [columnSetups])
  const { snapshot } = useOverview()
  const taskActivity = useMemo(() => activityByTask(snapshot, projectId), [snapshot, projectId])
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [agentKey, setAgentKey] = useState<string | null>(null)
  const [setupsOpen, setSetupsOpen] = useState(false)
  const layout: BoardLayout = route.view ?? 'kanban'
  const filter = route.filter ?? 'all'
  const { view } = board

  const fetchedAt = view?.fetchedAt
  useEffect(() => {
    if (!fetchedAt) return
    void refreshSignals(false)
    void reloadPersonal()
  }, [fetchedAt, refreshSignals, reloadPersonal])

  const priorities = useMemo(
    () => [...new Set((view?.cards ?? []).flatMap((c) => (c.priority ? [c.priority.name] : [])))],
    [view?.cards]
  )
  const stages = view?.config?.stages ?? null
  const signalsByTask = signals.result?.signals
  const entries = useMemo(
    () =>
      boardEntries(
        [{ projectId, projectName, stages, cards: view?.cards ?? [] }],
        'single',
        personal.byKey,
        new Map([[projectId, signalsByTask ?? {}]])
      ),
    [projectId, projectName, stages, view?.cards, personal.byKey, signalsByTask]
  )
  const columns = useMemo(
    () => (stages ? singleBoardColumns(stages, entries) : []),
    [stages, entries]
  )
  const attention = useMemo(() => attentionCount(entries), [entries])
  const visible = useMemo(
    () =>
      visibleEntries(entries, { filter, query, priority, onlyBlocked }).filter(
        (e) => !agentKey || agentBadges[e.card.taskId]?.key === agentKey
      ),
    [entries, filter, query, priority, onlyBlocked, agentKey, agentBadges]
  )

  const header = (): React.JSX.Element => (
    <ScreenBarStart>
      <ScreenTitle look={5}>Quadro</ScreenTitle>
      {picker}
    </ScreenBarStart>
  )

  if (!view) {
    return (
      <div className="flex flex-col gap-5 p-4">
        {header()}
        {board.error ? (
          <ErrorAlert error={board.error} onOpenIntegrations={onOpenIntegrations} />
        ) : (
          <PageState kind="loading" label="Carregando quadro" />
        )}
      </div>
    )
  }

  if (!view.config) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[63rem] flex-col gap-5 px-8 py-6">
          {header()}
          <BoardSettings view={view} onSave={(input) => board.save(input)} onCancel={undefined} />
        </div>
      </div>
    )
  }

  const actions: CardActions = {
    onOpen: onOpenTask,
    onMove: (taskId: string, stageId: string) => void board.move(taskId, stageId),
    // Fase 1: coluna com modo padrão → escolher como esta tarefa roda ao mover.
    runModes,
    onMoveWithMode: (taskId: string, stageId: string, mode: RunMode | null) => {
      void ipcResult(async () => {
        const current = await window.orkio.taskSetup.get(projectId, taskId)
        const task = current.ok ? { ...current.value.task } : {}
        if (mode) task.mode = mode
        else delete task.mode
        return window.orkio.taskSetup.save(projectId, taskId, task)
      }).then(() => void board.move(taskId, stageId))
    },
    onToggleBlocked: (taskId: string, blocked: boolean) => void board.setBlocked(taskId, blocked),
    onToggleAutomation: (taskId: string, paused: boolean) =>
      void board.setAutomationPaused(taskId, paused)
  }
  const actionsFor = (): CardActions => actions
  const refreshing = board.loading || automation.running

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3.5">
      <ScreenBarStart>
        <ScreenTitle look={5}>Quadro</ScreenTitle>
        {picker}
        <BoardViewControl
          value={layout}
          onChange={(view) => onRoute(boardRoute({ ...route, view }))}
        />
        <AgentRow
          cards={view.cards}
          badges={agentBadges}
          activity={taskActivity}
          selected={agentKey}
          onSelect={setAgentKey}
        />
      </ScreenBarStart>
      <ScreenBarEnd>
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={() => {
            void automation.runNow().then(() => {
              void personal.reload()
              return board.load(true)
            })
          }}
        >
          {refreshing ? <Spinner className="size-3.5" /> : <RefreshIcon />}
          Atualizar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Mais ações do quadro">
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpenBoardSettings(projectId)}>
              Configurar etapas e regras
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSetupsOpen(true)}>
              Como as colunas rodam
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void automation.setPaused(!automation.status?.paused)}
            >
              {automation.status?.paused ? 'Retomar automações' : 'Pausar todas'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ScreenBarEnd>
      <BoardFilters
        filter={filter}
        attention={attention}
        onFilter={(f) => onRoute(boardRoute({ ...route, filter: f }))}
        query={query}
        onQuery={setQuery}
      >
        <PriorityFilter priorities={priorities} value={priority} onChange={setPriority} />
        <CheckboxField label="Só bloqueadas" checked={onlyBlocked} onChange={setOnlyBlocked} />
        <div className="flex-1" />
        <AutomationLine status={automation.status} onOpenIntegrations={onOpenIntegrations} />
      </BoardFilters>
      <PendingWritesAlert count={view.pendingCount} onRetry={() => void board.retryNow()} />
      <SignalsMessages result={signals.result} />
      {board.error && <ErrorAlert error={board.error} onOpenIntegrations={onOpenIntegrations} />}
      <BoardNoticeAlert
        notice={board.notice}
        onDismiss={board.dismissNotice}
        onOpenIntegrations={onOpenIntegrations}
      />
      {view.issues.length > 0 && (
        <Alert tone={view.issues.some((i) => i.level === 'error') ? 'danger' : 'warning'}>
          <div className="flex flex-col gap-1">
            {view.issues.map((i) => (
              <p key={`${i.stageId}-${i.message}`}>{i.message}</p>
            ))}
          </div>
        </Alert>
      )}
      {view.truncated && (
        <p className="px-1 text-xs text-muted-foreground">
          Mostrando as 500 tarefas mais recentes deste projeto.
        </p>
      )}

      <div className="relative min-h-72 flex-1">
        {view.cards.length === 0 ? (
          <EmptyState
            title="Nenhuma tarefa neste projeto"
            description="As tarefas do Notion ligadas a este projeto aparecem aqui."
          />
        ) : (
          <AgentBadgesProvider value={agentBadges}>
            {layout === 'list' ? (
              <BoardList
                mode="single"
                columns={columns}
                entries={visible}
                actionsFor={actionsFor}
              />
            ) : (
              <BoardColumns
                mode="single"
                columns={columns}
                entries={visible}
                actionsFor={actionsFor}
              />
            )}
          </AgentBadgesProvider>
        )}
      </div>
      {setupsOpen && (
        <ColumnSetupsDialog projectId={projectId} onClose={() => setSetupsOpen(false)} />
      )}
    </div>
  )
}

/** Estado das automações do projeto (fonte compartilhada, relida a cada 15 s com a janela visível). */
function useAutomationStatus(projectId: string): {
  status: AutomationStatus | null
  running: boolean
  runNow(): Promise<void>
  setPaused(paused: boolean): Promise<void>
} {
  const { automation } = useSources()
  const status = useSource(automation, projectId).value
  const [running, setRunning] = useState(false)
  const apply = (next: AutomationStatus | null): void => {
    if (next) automation.set(projectId, next)
  }
  return {
    status,
    running,
    runNow: async () => {
      setRunning(true)
      const next = await ipcCall(() => window.orkio.automation.runNow(projectId), null)
      setRunning(false)
      apply(next)
    },
    setPaused: async (paused) => {
      apply(await ipcCall(() => window.orkio.automation.setPaused(projectId, paused), null))
    }
  }
}

function AutomationLine({
  status,
  onOpenIntegrations
}: {
  status: AutomationStatus | null
  onOpenIntegrations(): void
}): React.JSX.Element | null {
  if (!status) return null
  const time = (iso: string | null): string => (iso ? formatTime(iso) : '—')
  const text = status.paused
    ? 'Automações pausadas para todos os projetos'
    : status.github === 'disconnected'
      ? 'Automações só com eventos locais'
      : status.github === 'rate_limited'
        ? `Limite do GitHub: próxima verificação às ${time(status.nextRunAt)}`
        : status.github === 'ok'
          ? `GitHub verificado às ${time(status.lastRunAt)}`
          : status.github === 'unverified' || status.error
            ? `Falhou às ${time(status.lastRunAt)}${status.error ? ` (${status.error})` : ' (sem conexão com o GitHub)'}; nova tentativa às ${time(status.nextRunAt)}`
            : status.lastRunAt
              ? `Verificado às ${time(status.lastRunAt)}`
              : 'Aguardando a primeira verificação'
  const detail = status.paused
    ? 'Os eventos são registrados no histórico, sem mover tarefas.'
    : 'As automações movem as tarefas pelos eventos do git e do GitHub.'
  const Icon = status.paused ? PauseIcon : AutomationIcon
  return (
    <div className="flex items-center gap-2" data-testid="automation-status">
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 text-subtle-foreground" />
            {text}
          </p>
        </TooltipTrigger>
        <TooltipContent side="bottom">{detail}</TooltipContent>
      </Tooltip>
      {!status.paused && status.github === 'disconnected' && (
        <Button size="xs" variant="ghost" onClick={onOpenIntegrations}>
          Conectar GitHub
        </Button>
      )}
    </div>
  )
}

function AgentRow({
  cards,
  badges,
  activity,
  selected,
  onSelect
}: {
  cards: readonly { taskId: string }[]
  badges: AgentBadges
  activity: ReadonlyMap<string, TaskActivity>
  selected: string | null
  onSelect(key: string | null): void
}): React.JSX.Element | null {
  const agents = new Map<
    string,
    { name: string; color: AgentBadges[string]['color']; count: number; running: boolean }
  >()
  for (const { taskId } of cards) {
    const badge = badges[taskId]
    if (!badge) continue
    const cur = agents.get(badge.key) ?? {
      name: badge.name,
      color: badge.color,
      count: 0,
      running: false
    }
    cur.count += 1
    if (activity.get(taskId)?.running) cur.running = true
    agents.set(badge.key, cur)
  }
  if (agents.size === 0) return null
  const list = [...agents.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))
  return (
    <div role="group" aria-label="Agentes do quadro" className="flex items-center gap-1">
      {list.map(([key, a]) => {
        const label = `${a.name}: ${a.count === 1 ? '1 tarefa' : `${a.count} tarefas`}${a.running ? ', rodando' : ''}`
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                aria-label={label}
                pressed={selected === key}
                onPressedChange={(pressed) => onSelect(pressed ? key : null)}
                className={cn(
                  'relative h-7 min-w-7 gap-1 px-1 font-mono text-2xs text-subtle-foreground',
                  'data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-border'
                )}
              >
                <AgentAvatar name={a.name} color={a.color} seed={key} />
                <span className="tabular">{a.count}</span>
                {a.running && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-brand"
                  />
                )}
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

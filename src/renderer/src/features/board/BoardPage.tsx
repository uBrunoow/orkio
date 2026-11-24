import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckboxField, SegmentedControl } from '@/components/form'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { ScreenTitle } from '../../components/ScreenTitle'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { EmptyState, PageState } from '../../components/PageState'
import { Spinner } from '../../components/Spinner'
import {
  AutomationIcon,
  MoreIcon,
  PauseIcon,
  RefreshIcon,
  SearchIcon
} from '../../components/icons'
import { ActiveFlowsProvider, useActiveFlows } from '../task-flows/active-flows'
import { AgentBadgesProvider, useAgentBadges, type AgentBadges } from '../agents/agent-badges'
import { AgentAvatar } from '../agents/AgentAvatar'
import type { ActiveFlows } from '../task-flows/active-flows'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import { BoardColumns } from './BoardColumns'
import { BoardList } from './BoardList'
import { BoardSettings } from './BoardSettings'
import { TaskActivityProvider, type TaskActivityMap } from './task-activity'
import { useOverview } from '../overview/useOverview'
import { useBoard } from './useBoard'
import type { AutomationStatus } from '../../../../shared/automation'
import type { ProjectView } from '../../../../shared/projects'
import { formatTime } from '../../lib/format'
import { ErrorAlert } from '../../components/ErrorAlert'
import { SignalsMessages } from '../notion-workspace/SignalsMessages'

/**
 * Tela "Quadro" do projeto atual (o projeto vem do menu). Etapas e automações, Fluxos e Contexto
 * do Claude são rotas próprias (6E); aqui fica só o quadro e, sem quadro ainda, a criação dele.
 */
export function BoardPage({
  project,
  onOpenIntegrations,
  onOpenProjects,
  onOpenTask
}: {
  /** Projeto atual vinculado ao Notion (null = nenhum). */
  project: ProjectView | null
  onOpenIntegrations(): void
  onOpenProjects(): void
  /** Abre a tela da tarefa. */
  onOpenTask(taskId: string): void
}): React.JSX.Element {
  if (!project) {
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
    <Board projectId={project.id} onOpenIntegrations={onOpenIntegrations} onOpenTask={onOpenTask} />
  )
}

function Board({
  projectId,
  onOpenIntegrations,
  onOpenTask
}: {
  projectId: string
  onOpenIntegrations(): void
  onOpenTask(taskId: string): void
}): React.JSX.Element {
  const board = useBoard(projectId)
  const automation = useAutomationStatus(projectId)
  const signals = useTaskSignals(projectId)
  const refreshSignals = signals.refresh
  const activeFlows = useActiveFlows(projectId)
  const agentBadges = useAgentBadges(projectId)
  const { snapshot } = useOverview()
  const taskActivity = useMemo(() => {
    const map: TaskActivityMap = {}
    for (const w of snapshot?.waiting ?? []) {
      if (w.task.projectId !== projectId) continue
      const cur = map[w.task.taskId] ?? { waiting: null, running: null }
      map[w.task.taskId] = { ...cur, waiting: cur.waiting ?? w.what }
    }
    for (const r of snapshot?.running ?? []) {
      if (r.task.projectId !== projectId) continue
      const cur = map[r.task.taskId] ?? { waiting: null, running: null }
      map[r.task.taskId] = { ...cur, running: cur.running ?? r.label }
    }
    return map
  }, [snapshot, projectId])
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [agentKey, setAgentKey] = useState<string | null>(null)
  const [layout, setLayout] = useState<'kanban' | 'list'>('kanban')
  const { view } = board

  // Branches/PRs depois de carregar o quadro.
  const fetchedAt = view?.fetchedAt
  useEffect(() => {
    if (fetchedAt) void refreshSignals(false)
  }, [fetchedAt, refreshSignals])

  const priorities = useMemo(
    () => [...new Set((view?.cards ?? []).flatMap((c) => (c.priority ? [c.priority.name] : [])))],
    [view?.cards]
  )
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (view?.cards ?? []).filter(
      (c) =>
        (!q ||
          c.title.toLowerCase().includes(q) ||
          (c.displayId ?? '').toLowerCase().includes(q)) &&
        (!priority || c.priority?.name === priority) &&
        (!onlyBlocked || c.blocked) &&
        (!agentKey || agentBadges[c.taskId]?.key === agentKey)
    )
  }, [view?.cards, query, priority, onlyBlocked, agentKey, agentBadges])

  const header = (): React.JSX.Element => (
    <ScreenBarStart>
      <ScreenTitle look={5}>Quadro</ScreenTitle>
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

  const actions = {
    onOpen: onOpenTask,
    onMove: (taskId: string, stageId: string) => void board.move(taskId, stageId),
    onToggleBlocked: (taskId: string, blocked: boolean) => void board.setBlocked(taskId, blocked),
    onToggleAutomation: (taskId: string, paused: boolean) =>
      void board.setAutomationPaused(taskId, paused)
  }
  const refreshing = board.loading || automation.running

  return (
    // Ocupa a altura útil da janela: as colunas e o painel rolam por dentro.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3.5">
      <ScreenBarStart>
        <ScreenTitle look={5}>Quadro</ScreenTitle>
        <SegmentedControl
          label="Visualização do quadro"
          size="sm"
          value={layout}
          onChange={(v) => setLayout(v === 'list' ? 'list' : 'kanban')}
          options={[
            { value: 'kanban', label: 'Kanban' },
            { value: 'list', label: 'Lista' }
          ]}
        />
        <AgentRow
          cards={view.cards}
          badges={agentBadges}
          flows={activeFlows}
          selected={agentKey}
          onSelect={setAgentKey}
        />
      </ScreenBarStart>
      <ScreenBarEnd>
        <div className="relative w-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            type="search"
            aria-label="Buscar tarefas"
            placeholder="Filtrar por ID ou título"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={() => {
            // Verifica git/GitHub agora (automações) e relê o Notion.
            void automation.runNow().then(() => board.load(true))
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
            <DropdownMenuItem
              onSelect={() => void automation.setPaused(!automation.status?.paused)}
            >
              {automation.status?.paused ? 'Retomar automações' : 'Pausar todas'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ScreenBarEnd>
      {/* Filtros finos e o estado das automações, numa linha só acima das colunas. */}
      <div
        role="toolbar"
        aria-label="Filtros do quadro"
        className="flex flex-wrap items-center gap-4 px-1"
      >
        {priorities.length > 0 && (
          <Select
            aria-label="Prioridade"
            size="sm"
            placeholder="Todas as prioridades"
            clearLabel="Todas as prioridades"
            onClear={() => setPriority(null)}
            options={priorities.map((p) => ({ value: p, label: p }))}
            value={priority}
            onChange={(value) => setPriority(value)}
            className="w-48"
          />
        )}
        <CheckboxField label="Só bloqueadas" checked={onlyBlocked} onChange={setOnlyBlocked} />
        <div className="flex-1" />
        <AutomationLine status={automation.status} onOpenIntegrations={onOpenIntegrations} />
      </div>
      {view.pendingCount > 0 && (
        <Alert
          tone="warning"
          action={
            <Button size="sm" variant="outline" onClick={() => void board.retryNow()}>
              Tentar agora
            </Button>
          }
        >
          {view.pendingCount === 1
            ? '1 alteração aguardando o Notion.'
            : `${view.pendingCount} alterações aguardando o Notion.`}{' '}
          Elas são enviadas sozinhas quando a conexão voltar, mesmo depois de fechar o Orkio.
        </Alert>
      )}
      <SignalsMessages result={signals.result} />
      {board.error && <ErrorAlert error={board.error} onOpenIntegrations={onOpenIntegrations} />}
      {board.notice && (
        <Alert
          tone="danger"
          action={
            <>
              {board.notice.canReconnect && (
                <Button size="sm" variant="ghost" onClick={onOpenIntegrations}>
                  Ir para Integrações
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={board.dismissNotice}>
                Fechar aviso
              </Button>
            </>
          }
        >
          {board.notice.message}
        </Alert>
      )}
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
          <TaskActivityProvider value={taskActivity}>
            <ActiveFlowsProvider value={activeFlows}>
              <AgentBadgesProvider value={agentBadges}>
                {layout === 'list' ? (
                  <BoardList
                    stages={view.config.stages}
                    cards={cards}
                    signals={signals.result?.signals ?? {}}
                    actions={actions}
                  />
                ) : (
                  <BoardColumns
                    stages={view.config.stages}
                    cards={cards}
                    signals={signals.result?.signals ?? {}}
                    actions={actions}
                  />
                )}
              </AgentBadgesProvider>
            </ActiveFlowsProvider>
          </TaskActivityProvider>
        )}
      </div>
    </div>
  )
}

/** Estado das automações do projeto (atualiza a cada 15 s enquanto a tela está aberta). */
function useAutomationStatus(projectId: string): {
  status: AutomationStatus | null
  running: boolean
  runNow(): Promise<void>
  setPaused(paused: boolean): Promise<void>
} {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    let active = true
    const load = (): void => {
      void window.orkio.automation
        .status(projectId)
        .then((s) => {
          if (active) setStatus(s)
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [projectId])
  return {
    status,
    running,
    runNow: async () => {
      setRunning(true)
      const next = await window.orkio.automation.runNow(projectId).catch(() => null)
      setRunning(false)
      if (next) setStatus(next)
    },
    setPaused: async (paused) => {
      const next = await window.orkio.automation.setPaused(paused).catch(() => null)
      if (next)
        setStatus({
          ...next,
          ...(status
            ? { github: status.github, lastRunAt: status.lastRunAt, nextRunAt: status.nextRunAt }
            : {})
        })
    }
  }
}

/** Estado das automações, curto, no cabeçalho do quadro. */
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

/**
 * Agentes com tarefas neste quadro: avatar e quantas tarefas. Clicar filtra o quadro pelo agente;
 * o ponto laranja marca agente com fluxo rodando agora.
 */
function AgentRow({
  cards,
  badges,
  flows,
  selected,
  onSelect
}: {
  cards: readonly { taskId: string }[]
  badges: AgentBadges
  flows: ActiveFlows
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
    if (flows[taskId] === 'running') cur.running = true
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

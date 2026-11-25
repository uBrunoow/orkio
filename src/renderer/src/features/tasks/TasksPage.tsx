import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/form'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { PageState } from '../../components/PageState'
import { ScreenTitle } from '../../components/ScreenTitle'
import { RefreshIcon, SearchIcon, SettingsIcon } from '../../components/icons'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import type { Route, TasksView } from '../../app/routes'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { formatDateTime } from '../../lib/format'
import type { BoardTaskRef } from '../../../../shared/overview'
import {
  PR_CHIP_TEXT,
  TASK_FILTERS,
  TASK_FILTER_TEXT,
  TASK_LANES,
  TASK_LANE_TEXT,
  filterTasks,
  groupByLane,
  type PersonalTask,
  type PrChip,
  type TaskFilter,
  type TaskLane
} from '../../../../shared/task-lanes'
import { RUN_MODE_TEXT, type RunMode } from '../../../../shared/task-setup'
import { ColumnSetupsDialog } from './ColumnSetupsDialog'
import { ModeCards } from './ModeCards'

/**
 * Tarefas (Fase 1): kanban derivado pessoal. As raias vêm do estado do fluxo e da PR (nada é
 * manual); mover de coluna continua no Quadro (o do time, ligado ao Notion). Vazio = ponto de
 * partida: escolher como a coluna de trabalho roda.
 */
export function TasksPage({
  route,
  projectId,
  onRoute,
  onOpenTask,
  onOpenBoard
}: {
  route: Extract<Route, { name: 'tasks' }>
  /** Projeto atual vinculado (para "Como as colunas rodam"); `null` = nenhum. */
  projectId: string | null
  onRoute(route: Route): void
  onOpenTask(ref: BoardTaskRef): void
  onOpenBoard(): void
}): React.JSX.Element {
  const view: TasksView = route.view ?? 'kanban'
  const filter: TaskFilter = route.filter ?? 'all'
  const [query, setQuery] = useState('')
  const [columns, setColumns] = useState<{ stage: string | null } | null>(null)
  const data = useIpcResource('', () => window.orkio.overview.tasks().then(unwrap), {
    subscribe: (reload) => {
      const offs = [
        window.orkio.overview.onChanged(reload),
        window.orkio.taskFlows.onChanged(reload),
        window.orkio.board.onChanged(reload)
      ]
      return () => offs.forEach((off) => off())
    },
    pollMs: 30_000
  })
  const all = data.value?.tasks ?? null
  const tasks = all ? filterTasks(all, filter, query) : null

  const set = (next: Partial<Extract<Route, { name: 'tasks' }>>): void =>
    onRoute({ name: 'tasks', view, filter, ...next })

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <ScreenBarStart>
        <ScreenTitle look={5}>Tarefas</ScreenTitle>
        <SegmentedControl
          label="Visualização das tarefas"
          size="sm"
          value={view}
          onChange={(v) => set({ view: v === 'list' ? 'list' : 'kanban' })}
          options={[
            { value: 'kanban', label: 'Kanban' },
            { value: 'list', label: 'Lista' }
          ]}
        />
      </ScreenBarStart>
      <ScreenBarEnd>
        <div className="relative w-52">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            type="search"
            aria-label="Buscar tarefas"
            placeholder="Buscar por ID, título ou projeto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {projectId && (
          <Button variant="ghost" size="sm" onClick={() => setColumns({ stage: null })}>
            <SettingsIcon />
            Como as colunas rodam
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Atualizar tarefas"
          onClick={() => void data.reload()}
        >
          <RefreshIcon />
        </Button>
      </ScreenBarEnd>

      <div role="toolbar" aria-label="Filtros das tarefas" className="flex items-center gap-1">
        {TASK_FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={f === filter ? 'secondary' : 'ghost'}
            aria-pressed={f === filter}
            onClick={() => set({ filter: f })}
          >
            {TASK_FILTER_TEXT[f]}
          </Button>
        ))}
      </div>

      {tasks === null ? (
        data.error ? (
          <Alert tone="danger">{data.error.message}</Alert>
        ) : (
          <PageState kind="loading" label="Carregando tarefas" />
        )
      ) : all!.length === 0 ? (
        <StartingPoints
          projectId={projectId}
          onColumns={(stage) => setColumns({ stage })}
          onOpenBoard={onOpenBoard}
        />
      ) : view === 'kanban' ? (
        <LanesKanban tasks={tasks} onOpenTask={onOpenTask} />
      ) : (
        <TasksList tasks={tasks} onOpenTask={onOpenTask} />
      )}

      {columns && projectId && (
        <ColumnSetupsDialog
          projectId={projectId}
          initialStage={columns.stage}
          onClose={() => setColumns(null)}
        />
      )}
    </div>
  )
}

function laneDot(lane: TaskLane): string {
  // Uma cor só "alta": o que precisa de você. O resto fica neutro.
  return lane === 'needs_you' ? 'bg-brand' : lane === 'done' ? 'bg-ok/70' : 'bg-subtle-foreground'
}

function taskRef(t: PersonalTask): BoardTaskRef {
  return { projectId: t.task.projectId, taskId: t.task.taskId }
}

function taskLabel(t: PersonalTask): string {
  return t.task.displayId ?? t.task.title ?? 'Tarefa do Notion'
}

function Chips({ chips }: { chips: readonly PrChip[] }): React.JSX.Element | null {
  if (chips.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c}
          className={cn(
            'rounded-sm border px-1.5 py-px text-2xs',
            PR_CHIP_TEXT[c].attention
              ? 'border-border text-foreground'
              : 'border-border-soft text-muted-foreground'
          )}
        >
          {PR_CHIP_TEXT[c].label}
        </span>
      ))}
    </span>
  )
}

function LanesKanban({
  tasks,
  onOpenTask
}: {
  tasks: readonly PersonalTask[]
  onOpenTask(ref: BoardTaskRef): void
}): React.JSX.Element {
  const lanes = groupByLane(tasks)
  return (
    <div
      role="list"
      aria-label="Raias das tarefas"
      className="flex min-h-0 flex-1 items-stretch gap-2.5 overflow-x-auto pb-2"
    >
      {TASK_LANES.map((lane) => (
        <div
          key={lane}
          role="listitem"
          aria-label={TASK_LANE_TEXT[lane].label}
          className="flex w-[260px] shrink-0 flex-col gap-2 rounded-[10px] border border-border-soft bg-surface p-2"
        >
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <span aria-hidden="true" className={cn('size-[7px] rounded-full', laneDot(lane))} />
            <h2
              className={cn(
                'font-normal',
                lane === 'needs_you' && lanes[lane].length > 0 && 'text-foreground'
              )}
            >
              {TASK_LANE_TEXT[lane].label}
            </h2>
            <span className="tabular text-subtle-foreground" data-testid="lane-count">
              {lanes[lane].length}
            </span>
          </div>
          <div
            role="list"
            aria-label={`Tarefas em ${TASK_LANE_TEXT[lane].label}`}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5"
          >
            {lanes[lane].length === 0 ? (
              <p className="px-1 py-3 text-center text-xs text-subtle-foreground">
                {TASK_LANE_TEXT[lane].empty}
              </p>
            ) : (
              lanes[lane].map((t) => (
                <button
                  key={`${t.task.projectId}:${t.task.taskId}`}
                  type="button"
                  role="listitem"
                  aria-label={taskLabel(t)}
                  onClick={() => onOpenTask(taskRef(t))}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-[9px] border bg-card px-[11px] py-2.5 text-left',
                    'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    lane === 'needs_you' ? 'border-brand-tint-border' : 'border-border-soft'
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="font-mono text-2xs text-subtle-foreground">
                      {t.task.displayId ?? '—'}
                    </span>
                    <span className="ml-auto truncate text-2xs text-subtle-foreground">
                      {t.task.projectName}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-sm text-foreground">
                    {t.task.title ?? taskLabel(t)}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{t.what}</span>
                  <Chips chips={t.chips} />
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function TasksList({
  tasks,
  onOpenTask
}: {
  tasks: readonly PersonalTask[]
  onOpenTask(ref: BoardTaskRef): void
}): React.JSX.Element {
  const lanes = groupByLane(tasks)
  const rows = TASK_LANES.flatMap((lane) => lanes[lane])
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma tarefa com este filtro.</p>
  }
  return (
    <div className="overflow-auto rounded-lg border border-border-soft">
      <table className="w-full text-sm" aria-label="Lista de tarefas">
        <thead className="border-b border-border-soft text-left text-xs text-subtle-foreground">
          <tr>
            <th className="px-3 py-2 font-normal">Tarefa</th>
            <th className="px-3 py-2 font-normal">Estado</th>
            <th className="px-3 py-2 font-normal">O quê</th>
            <th className="px-3 py-2 font-normal">Projeto</th>
            <th className="px-3 py-2 font-normal">Desde</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={`${t.task.projectId}:${t.task.taskId}`}
              className="border-b border-border-soft last:border-0 hover:bg-muted/40"
            >
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="flex flex-col items-start text-left focus-visible:underline focus-visible:outline-none"
                  onClick={() => onOpenTask(taskRef(t))}
                >
                  <span className="font-mono text-2xs text-subtle-foreground">
                    {t.task.displayId ?? '—'}
                  </span>
                  <span className="text-foreground">{t.task.title ?? taskLabel(t)}</span>
                </button>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn('size-[7px] rounded-full', laneDot(t.lane))}
                  />
                  {TASK_LANE_TEXT[t.lane].label}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <span className="flex flex-col gap-1">
                  {t.what}
                  <Chips chips={t.chips} />
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{t.task.projectName}</td>
              <td className="px-3 py-2 whitespace-nowrap text-subtle-foreground">
                {formatDateTime(t.since)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Estado vazio = ponto de partida: os três jeitos de rodar como modelos para a coluna de trabalho
 * do projeto atual. O Orkio não cria tarefas: elas vêm do Notion pelo Quadro.
 */
function StartingPoints({
  projectId,
  onColumns,
  onOpenBoard
}: {
  projectId: string | null
  onColumns(stage: string | null): void
  onOpenBoard(): void
}): React.JSX.Element {
  const columns = useIpcResource(projectId, (id) => window.orkio.taskSetup.columns(id).then(unwrap))
  const [mode, setMode] = useState<RunMode>('quick')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const work =
    columns.value?.stages.find((s) => s.role === 'work') ?? columns.value?.stages[0] ?? null
  const use = (): void => {
    if (!projectId || !work) return
    setError(null)
    void ipcResult(() =>
      window.orkio.taskSetup.saveColumn(projectId, work.id, { ...work.setup, mode })
    ).then((r) => {
      if (r.ok) {
        columns.set(r.value)
        setSaved(`Tarefas que entrarem em ${work.name} vão “${RUN_MODE_TEXT[mode].label}”.`)
      } else setError(r.error.message)
    })
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-10 text-center">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-medium">Nada em andamento ainda</h2>
        <p className="text-sm text-muted-foreground">
          Uma tarefa aparece aqui quando um agente começa a trabalhar nela. Escolha como as tarefas
          rodam e mova uma para a coluna de trabalho no Quadro.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onOpenBoard}>
        Abrir o Quadro
      </Button>
      {projectId && work && (
        <section
          aria-label="Começar de um modelo"
          className="flex w-full flex-col gap-3 rounded-xl border border-border-soft p-4 text-left"
        >
          <div className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium">Como as tarefas devem rodar em {work.name}?</h3>
            <p className="text-xs text-muted-foreground">
              Você muda depois, por coluna ou em cada tarefa.
            </p>
          </div>
          <ModeCards value={mode} onChange={(v) => setMode(v === 'inherit' ? 'quick' : v)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={use}>
              Usar em {work.name}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onColumns(work.id)}>
              Mais opções
            </Button>
            {saved && (
              <p role="status" className="text-xs text-muted-foreground">
                {saved}
              </p>
            )}
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </section>
      )}
    </div>
  )
}

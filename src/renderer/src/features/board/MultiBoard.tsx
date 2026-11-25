import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { CheckboxField } from '@/components/form'
import { ErrorAlert } from '../../components/ErrorAlert'
import { ScreenTitle } from '../../components/ScreenTitle'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { EmptyState, PageState } from '../../components/PageState'
import { Spinner } from '../../components/Spinner'
import { MoreIcon, RefreshIcon } from '../../components/icons'
import { ColumnSetupsDialog } from '../tasks/ColumnSetupsDialog'
import { BoardColumns } from './BoardColumns'
import {
  BoardNoticeAlert,
  BoardViewControl,
  PendingWritesAlert,
  PriorityFilter
} from './BoardBarParts'
import { BoardFilters } from './BoardFilters'
import { BoardList } from './BoardList'
import {
  attentionCount,
  boardEntries,
  roleBoardColumns,
  visibleEntries,
  type ProjectBoardInput
} from './board-model'
import { usePersonalTasks } from './usePersonalTasks'
import { useBoards } from './useBoard'
import { boardRoute, type BoardLayout, type Route } from '../../app/routes'
import { useSources } from '../../app/sources'
import { ipcCall, useSource, useSourceMany } from '../../lib/ipc'
import type { CardActions } from './BoardCardView'
import type { BoardTaskRef } from '../../../../shared/overview'
import type { TaskSignals } from '../../../../shared/task-signals'

const SEP = '\u0000'

/**
 * Quadro de vários projetos: colunas pelo papel da etapa, o projeto no card e cada ação (mover,
 * bloquear, pausar) com os controles do projeto do card.
 */
export function MultiBoard({
  route,
  projects,
  picker,
  onRoute,
  onOpenTask,
  onOpenIntegrations,
  onOpenBoardSettings,
  onOpenSingle
}: {
  route: Extract<Route, { name: 'board' }>
  /** Projetos escolhidos (2 ou mais), na ordem do seletor. */
  projects: readonly { id: string; name: string }[]
  /** O seletor de projetos (montado pelo `BoardPage`). */
  picker: React.ReactNode
  onRoute(route: Route): void
  onOpenTask(ref: BoardTaskRef): void
  onOpenIntegrations(): void
  onOpenBoardSettings(projectId: string): void
  /** Abre o Quadro só deste projeto (ex.: para criar o quadro dele). */
  onOpenSingle(projectId: string): void
}): React.JSX.Element {
  // A lista chega nova a cada render: ids e nomes ficam estáveis pelo conteúdo, não pela identidade.
  const idsKey = projects.map((p) => p.id).join(SEP)
  const namesKey = projects.map((p) => p.name).join(SEP)
  const ids = useMemo(() => (idsKey === '' ? [] : idsKey.split(SEP)), [idsKey])
  const nameOf = useMemo(() => {
    const names = namesKey.split(SEP)
    return new Map(ids.map((id, i) => [id, names[i] ?? id]))
  }, [ids, namesKey])
  const boards = useBoards(ids)
  const { signals, automation, board: boardSource } = useSources()
  const signalStates = useSourceMany(signals, ids)
  const firstId = ids[0] ?? null
  // A pausa das automações vale para todos os projetos: o estado de um basta.
  const automationStatus = useSource(automation, firstId).value
  const personal = usePersonalTasks()
  const reloadPersonal = personal.reload
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [setupsFor, setSetupsFor] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const layout: BoardLayout = route.view ?? 'kanban'
  const filter = route.filter ?? 'all'

  const fetchedKey = boards.map((b) => b.state.value?.view.fetchedAt ?? '').join('|')
  useEffect(() => {
    if (fetchedKey.replaceAll('|', '') === '') return
    for (const id of ids) void signals.reload(id)
    void reloadPersonal()
  }, [fetchedKey, ids, signals, reloadPersonal])

  const inputs = useMemo<ProjectBoardInput[]>(
    () =>
      boards.flatMap((b) => {
        const view = b.state.value?.view
        if (!view) return []
        return [
          {
            projectId: b.projectId,
            projectName: nameOf.get(b.projectId) ?? b.projectId,
            stages: view.config?.stages ?? null,
            cards: view.cards
          }
        ]
      }),
    [boards, nameOf]
  )
  const signalsByProject = useMemo(
    () =>
      new Map<string, Record<string, TaskSignals>>(
        ids.map((id, i) => [id, signalStates[i]?.value?.signals ?? {}])
      ),
    [ids, signalStates]
  )
  const entries = useMemo(
    () => boardEntries(inputs, 'roles', personal.byKey, signalsByProject),
    [inputs, personal.byKey, signalsByProject]
  )
  const columns = useMemo(() => roleBoardColumns(inputs, entries), [inputs, entries])
  const attention = useMemo(() => attentionCount(entries), [entries])
  const visible = useMemo(
    () => visibleEntries(entries, { filter, query, priority, onlyBlocked }),
    [entries, filter, query, priority, onlyBlocked]
  )
  const priorities = useMemo(
    () => [
      ...new Set(
        inputs.flatMap((i) =>
          i.stages ? i.cards.flatMap((c) => (c.priority ? [c.priority.name] : [])) : []
        )
      )
    ],
    [inputs]
  )

  /**
   * Ações por projeto: cada uma fecha sobre os controles daquele projeto (`boardControls(…, id)`),
   * que gravam na chave dele e chamam o main com o id dele. Nunca há um "controle atual".
   */
  const actionsByProject = useMemo(() => {
    const map = new Map<string, CardActions>()
    for (const { projectId, controls } of boards) {
      map.set(projectId, {
        onOpen: (taskId) => onOpenTask({ projectId, taskId }),
        onMove: (taskId, stageId) => void controls.move(taskId, stageId),
        onToggleBlocked: (taskId, blocked) => void controls.setBlocked(taskId, blocked),
        onToggleAutomation: (taskId, paused) => void controls.setAutomationPaused(taskId, paused)
      })
    }
    return map
  }, [boards, onOpenTask])
  const actionsFor = (projectId: string): CardActions => {
    const actions = actionsByProject.get(projectId)
    // As entradas saem dos mesmos quadros: sem ações = erro de programação, nunca outro projeto.
    if (!actions) throw new Error('Quadro sem ações para o projeto do card')
    return actions
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all(
        ids.map(async (id) => {
          const next = await ipcCall(() => window.orkio.automation.runNow(id), null)
          if (next) automation.set(id, next)
          await boardSource.reload(id, { force: true })
        })
      )
      await personal.reload()
    } finally {
      setRefreshing(false)
    }
  }

  const setPaused = async (paused: boolean): Promise<void> => {
    if (!firstId) return
    const next = await ipcCall(() => window.orkio.automation.setPaused(firstId, paused), null)
    if (!next) return
    // Só a pausa é global: o resto do estado (GitHub, horários, erro) é de cada projeto.
    for (const id of ids) {
      if (id === firstId) automation.set(id, next)
      else automation.set(id, (s) => (s ? { ...s, paused: next.paused } : s))
    }
  }

  const loading = boards.some((b) => b.state.value === null && b.state.error === null)
  const pending = boards.reduce((n, b) => n + (b.state.value?.view.pendingCount ?? 0), 0)
  const withoutBoard = boards.filter((b) => b.state.value && b.state.value.view.config === null)
  const busy = refreshing || boards.some((b) => b.state.loading)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3.5">
      <ScreenBarStart>
        <ScreenTitle look={5}>Quadro</ScreenTitle>
        {picker}
        <BoardViewControl
          value={layout}
          onChange={(view) => onRoute(boardRoute({ ...route, view }))}
        />
      </ScreenBarStart>
      <ScreenBarEnd>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
          {busy ? <Spinner className="size-3.5" /> : <RefreshIcon />}
          Atualizar
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Mais ações do quadro">
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Configurar etapas e regras</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => onOpenBoardSettings(p.id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Como as colunas rodam</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} onSelect={() => setSetupsFor(p.id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => void setPaused(!automationStatus?.paused)}>
              {automationStatus?.paused ? 'Retomar automações' : 'Pausar todas'}
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
      </BoardFilters>
      <PendingWritesAlert count={pending} onRetry={() => void boards[0]?.controls.retryNow()} />
      {boards.map(({ projectId, state }) =>
        state.error ? (
          <ErrorAlert
            key={`error-${projectId}`}
            error={{ ...state.error, message: `${nameOf.get(projectId)}: ${state.error.message}` }}
            onOpenIntegrations={onOpenIntegrations}
          />
        ) : null
      )}
      {boards.map(({ projectId, state, controls }) => (
        <BoardNoticeAlert
          key={`notice-${projectId}`}
          notice={state.value?.notice ?? null}
          prefix={nameOf.get(projectId) ?? projectId}
          onDismiss={controls.dismissNotice}
          onOpenIntegrations={onOpenIntegrations}
        />
      ))}
      {withoutBoard.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
          <p>Sem quadro ainda: {withoutBoard.map((b) => nameOf.get(b.projectId)).join(', ')}</p>
          {withoutBoard.map((b) => (
            <Button
              key={b.projectId}
              size="xs"
              variant="ghost"
              onClick={() => onOpenSingle(b.projectId)}
            >
              Criar quadro de {nameOf.get(b.projectId)}
            </Button>
          ))}
        </div>
      )}

      <div className="relative min-h-72 flex-1">
        {loading ? (
          <PageState kind="loading" label="Carregando quadros" />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nenhuma tarefa nestes projetos"
            description="As tarefas do Notion ligadas aos projetos escolhidos aparecem aqui."
          />
        ) : layout === 'list' ? (
          <BoardList mode="roles" columns={columns} entries={visible} actionsFor={actionsFor} />
        ) : (
          <BoardColumns mode="roles" columns={columns} entries={visible} actionsFor={actionsFor} />
        )}
      </div>
      {setupsFor && <ColumnSetupsDialog projectId={setupsFor} onClose={() => setSetupsFor(null)} />}
    </div>
  )
}

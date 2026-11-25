/**
 * Tela Terminais (dock): terminais embutidos na pasta do projeto atual, em abas, abertos na hora.
 * Os terminais das tarefas (cada um no worktree da sua tarefa) ficam no menu "Das tarefas", que
 * leva até a aba Terminal da tarefa. Os processos vivem no main: trocar de tela não fecha nada.
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  PROJECT_TERMINAL_TASK,
  type TaskTerminals,
  type TerminalView as TerminalInfo
} from '../../../../shared/terminal'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { Alert } from '../../components/Alert'
import { PageState } from '../../components/PageState'
import { ScreenTitle } from '../../components/ScreenTitle'
import { StatusDot } from '../../components/StatusToken'
import { CloseIcon, PlusIcon, TerminalIcon } from '../../components/icons'
import { ipcResult, unwrap, useIpcResource } from '../../lib/ipc'
import { taskKey } from '../board/board-model'
import { usePersonalTasks } from '../board/usePersonalTasks'
import { TerminalView } from './TerminalView'
import { useTaskTerminals } from './useTaskTerminals'

export function TerminalsPage({
  project,
  onOpenTask
}: {
  /** Projeto atual (a pasta onde o terminal abre); `null` = nenhum projeto ainda. */
  project: { id: string; name: string } | null
  onOpenTask(projectId: string, taskId: string): void
}): React.JSX.Element {
  if (!project) {
    return (
      <div className="p-6">
        <ScreenBarStart>
          <ScreenTitle look={5}>Terminais</ScreenTitle>
        </ScreenBarStart>
        <PageState
          kind="empty"
          title="Nenhum projeto ainda"
          description="Adicione um projeto em Configurações › Projetos para abrir um terminal na pasta dele."
        />
      </div>
    )
  }
  return <ProjectTerminals key={project.id} project={project} onOpenTask={onOpenTask} />
}

function ProjectTerminals({
  project,
  onOpenTask
}: {
  project: { id: string; name: string }
  onOpenTask(projectId: string, taskId: string): void
}): React.JSX.Element {
  const list = useTaskTerminals(project.id, PROJECT_TERMINAL_TASK)
  const [selected, setSelected] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terminals = list.value?.terminals ?? []
  const available = list.value?.available ?? true
  const current =
    terminals.find((t) => t.id === selected) ??
    terminals.findLast((t) => t.state === 'running') ??
    terminals.at(-1) ??
    null

  const openShell = async (): Promise<void> => {
    setOpening(true)
    setError(null)
    const r = await ipcResult(() => window.orkio.terminal.openInProject(project.id))
    setOpening(false)
    if (!r.ok) setError(r.error.message)
    else {
      setSelected(r.value.id)
      void list.reload()
    }
  }
  const close = (t: TerminalInfo): void => {
    if (selected === t.id) setSelected(null)
    void window.orkio.terminal.close(t.id)
  }

  // Abriu a tela sem terminal do projeto: já abre um (é para isso que se vem aqui).
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || !list.value) return
    autoOpened.current = true
    if (list.value.available && list.value.terminals.length === 0) {
      queueMicrotask(() => void openShell())
    }
    // Uma vez, quando a lista chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.value])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenBarStart>
        <div className="flex min-w-0 items-center gap-2">
          <ScreenTitle look={5}>Terminais</ScreenTitle>
          <span className="truncate text-sm text-subtle-foreground">{project.name}</span>
        </div>
      </ScreenBarStart>
      <ScreenBarEnd>
        <TaskTerminalsMenu onOpenTask={onOpenTask} />
      </ScreenBarEnd>

      <div className="flex shrink-0 items-center gap-1 border-b border-border-soft px-3 py-1.5">
        <div
          role="tablist"
          aria-label="Terminais do projeto"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {terminals.map((t, i) => {
            const active = current?.id === t.id
            const title = terminals.length > 1 ? `${t.title} ${i + 1}` : t.title
            return (
              <div
                key={t.id}
                className={cn(
                  'group flex h-7 shrink-0 items-center rounded-md border text-xs',
                  active
                    ? 'border-border-soft bg-card text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelected(t.id)}
                  className="flex h-full items-center gap-1.5 rounded-md pr-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <TerminalIcon aria-hidden="true" className="size-3.5" />
                  {title}
                  {t.state === 'exited' && <span className="text-subtle-foreground">· saiu</span>}
                </button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Fechar ${title}`}
                  onClick={() => close(t)}
                  className="mr-1 size-5 text-subtle-foreground"
                >
                  <CloseIcon aria-hidden="true" className="size-3" />
                </Button>
              </div>
            )
          })}
        </div>
        {available && (
          <Button size="sm" variant="ghost" disabled={opening} onClick={() => void openShell()}>
            <PlusIcon aria-hidden="true" />
            Novo terminal
          </Button>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-3 pt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {list.error && !list.value ? (
          <div className="p-6">
            <PageState kind="error" message={list.error.message} />
          </div>
        ) : !list.value ? (
          <div className="p-6">
            <PageState kind="loading" label="Carregando terminais" />
          </div>
        ) : !available ? (
          <div className="p-6">
            <PageState
              kind="empty"
              title="Terminal embutido indisponível"
              description="Este computador não carregou o terminal do Orkio. Na tarefa, “Abrir terminal aqui” usa o terminal do sistema."
            />
          </div>
        ) : current ? (
          <div className="flex h-full min-h-0 flex-col">
            <TerminalView
              key={current.id}
              id={current.id}
              running={current.state === 'running'}
              label={`Terminal ${current.title} de ${project.name}`}
            />
            {current.state === 'exited' && (
              <p className="flex shrink-0 items-center gap-2 border-t border-border-soft px-4 py-2 text-xs text-muted-foreground">
                <StatusDot tone="neutral" />O processo terminou
                {current.exitCode !== null ? ` (código ${current.exitCode})` : ''}.
              </p>
            )}
          </div>
        ) : (
          <div className="p-6">
            <PageState
              kind="empty"
              title={opening ? 'Abrindo um terminal…' : 'Nenhum terminal aberto'}
              description={`Abre na pasta de ${project.name}.`}
              {...(!opening
                ? { action: { label: 'Abrir terminal', onClick: () => void openShell() } }
                : {})}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** "Das tarefas": terminais abertos nas pastas das tarefas (todos os projetos). */
function TaskTerminalsMenu({
  onOpenTask
}: {
  onOpenTask(projectId: string, taskId: string): void
}): React.JSX.Element | null {
  const all = useIpcResource<TaskTerminals>(
    'all',
    () => ipcResult(() => window.orkio.terminal.all()).then(unwrap),
    { subscribe: (reload) => window.orkio.terminal.onChanged(() => reload()) }
  )
  const { byKey } = usePersonalTasks()
  const byTask = new Map<string, TerminalInfo[]>()
  for (const t of all.value?.terminals ?? []) {
    if (t.taskId === PROJECT_TERMINAL_TASK) continue
    const k = taskKey(t.projectId, t.taskId)
    byTask.set(k, [...(byTask.get(k) ?? []), t])
  }
  if (byTask.size === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <TerminalIcon />
          {`Das tarefas (${byTask.size})`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="label-caps">Terminais nas tarefas</DropdownMenuLabel>
        {[...byTask.values()].map((ts) => {
          const t = ts[0]!
          const p = byKey.get(taskKey(t.projectId, t.taskId))
          const running = ts.filter((x) => x.state === 'running').length
          return (
            <DropdownMenuItem key={t.taskId} onSelect={() => onOpenTask(t.projectId, t.taskId)}>
              <span className="font-mono text-xs text-subtle-foreground">
                {p?.task.displayId ?? 'Tarefa'}
              </span>
              <span className="min-w-0 flex-1 truncate">{p?.task.title ?? 'Tarefa do Notion'}</span>
              <StatusDot tone={running > 0 ? 'success' : 'neutral'} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

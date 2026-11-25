import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { StatusDot } from '../components/StatusToken'
import { ForkIcon, ListIcon, SwitchIcon } from '../components/icons'
import { Timestamp } from '@/components/Timestamp'
import { taskSessions, visibleSessionId } from '../features/task/task-sessions'
import { useTaskSessionList } from '../features/task/useTaskSessionList'
import type { Route } from './routes'
import type { SidebarTask, TaskGroups } from './task-groups'
import type { ProjectView } from '../../../shared/projects'
import { ProjectAvatar } from '../components/ProjectAvatar'

function TaskRow({
  task,
  isSelected,
  onOpen
}: {
  task: SidebarTask
  isSelected: boolean
  onOpen(): void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={isSelected ? 'page' : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
          isSelected && 'bg-sidebar-accent text-foreground'
        )}
      >
        <StatusDot tone={task.tone} />
        {task.displayId && (
          <span className="shrink-0 font-mono text-2xs text-subtle-foreground">
            {task.displayId} ·
          </span>
        )}
        <span className="min-w-0 truncate">{task.title}</span>
      </button>
    </li>
  )
}

function Section({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div role="group" aria-label={title} className="flex flex-col">
      <div aria-hidden="true" className="flex justify-between px-2 pt-3 pb-1 label-caps">
        <span>{title}</span>
        {count !== undefined && <span className="font-mono">{count}</span>}
      </div>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  )
}

/**
 * Sessões do Claude Code da tarefa aberta (como no Compozy): cada "Nova sessão", "Ramificar daqui"
 * e "Editar mensagem" é uma conversa à parte (cada comando do piloto automático também). A bolinha
 * laranja = rodando agora. "Conversa completa" mostra todas, como o fluxo as encadeia; escolher uma
 * mostra só ela e o campo continua nela.
 */
function TaskSessions({
  projectId,
  taskId,
  chosen,
  onSelect
}: {
  projectId: string
  taskId: string
  chosen: string | null
  onSelect(session: string | null): void
}): React.JSX.Element | null {
  const runs = useTaskSessionList({ projectId, taskId })
  if (!runs) return null
  const sessions = taskSessions(runs)
  if (sessions.length === 0) return null
  const shown = visibleSessionId(runs, chosen)
  const row =
    'flex w-full min-w-0 items-start gap-2 rounded-[7px] px-2 py-1.5 text-left text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40'
  return (
    <div className="mt-1.5">
      <Section title="Sessões" count={sessions.length}>
        <li>
          <button
            type="button"
            aria-current={shown === null ? 'true' : undefined}
            onClick={() => onSelect(null)}
            className={cn(
              row,
              'items-center',
              shown === null && 'bg-sidebar-accent text-foreground'
            )}
          >
            <ListIcon aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
            <span className="truncate">Conversa completa</span>
          </button>
        </li>
        {sessions.map((s) => {
          const selected = s.id === shown
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                aria-label={`Sessão ${s.number}: ${s.title}${s.live ? ', rodando' : ''}`}
                onClick={() => onSelect(s.id)}
                className={cn(row, selected && 'bg-sidebar-accent text-foreground')}
              >
                <span className="mt-[5px] grid size-2 shrink-0 place-items-center">
                  {s.live ? (
                    <span
                      aria-hidden="true"
                      className="size-2 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-subtle-foreground/50"
                    />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{s.title}</span>
                  <span className="flex items-center gap-1 text-2xs text-subtle-foreground">
                    {s.origin === 'fork' && <ForkIcon aria-hidden="true" className="size-3" />}
                    {s.origin === 'fork' ? 'Ramificada' : `Sessão ${s.number}`} ·{' '}
                    <Timestamp value={s.lastAt} />
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </Section>
    </div>
  )
}

/**
 * Coluna do projeto (ao lado do dock): projeto atual, as sessões da tarefa aberta, o que falta
 * configurar e as listas "Esperando você", "Rodando" e "A fazer"; a conta no pé. A busca de
 * tarefas fica no menu Sessão do cabeçalho (Ctrl/Cmd+P). Mostrar/esconder: Ctrl/Cmd+B.
 */
export function Sidebar({
  route,
  project,
  projects,
  groups,
  setupMissing,
  onChooseProject,
  onManageProjects,
  onSelectSession,
  onOpenTask,
  onNavigate,
  onContinueSetup,
  account
}: {
  account: React.ReactNode
  route: Route
  project: ProjectView | null
  projects: ProjectView[] | null
  groups: TaskGroups | null
  setupMissing: number
  onChooseProject(id: string): void
  onManageProjects(): void
  /** Lista "Sessões" da tarefa aberta: mostra a conversa daquela sessão (`null` = a mais recente). */
  onSelectSession(session: string | null): void
  onOpenTask(task: SidebarTask): void
  onNavigate(route: Route): void
  onContinueSetup(): void
}): React.JSX.Element {
  const section = (
    title: string,
    items: SidebarTask[],
    extra?: React.ReactNode
  ): React.ReactNode =>
    items.length === 0 ? null : (
      <Section title={title} count={items.length}>
        {items.map((t) => (
          <TaskRow
            key={t.taskId}
            task={t}
            isSelected={route.name === 'task' && route.taskId === t.taskId}
            onOpen={() => onOpenTask(t)}
          />
        ))}
        {extra}
      </Section>
    )

  return (
    <div className="flex h-full w-[248px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2.5 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Projeto atual: ${project ? project.name : 'nenhum'}. Trocar projeto`}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-[7px] text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {project && <ProjectAvatar size="sm" project={project} />}
          <span className="min-w-0 flex-1 truncate text-foreground">
            {project ? project.name : 'Nenhum projeto'}
          </span>
          <SwitchIcon className="size-3.5 text-subtle-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          {(projects ?? []).map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onChooseProject(p.id)}>
              <ProjectAvatar size="sm" project={p} />
              <span className="truncate">
                {p.id === project?.id ? `${p.name} (atual)` : p.name}
              </span>
            </DropdownMenuItem>
          ))}
          {(projects ?? []).length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={onManageProjects}>Gerenciar projetos…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {route.name === 'task' && (
        <TaskSessions
          projectId={route.projectId}
          taskId={route.taskId}
          chosen={route.session ?? null}
          onSelect={onSelectSession}
        />
      )}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        {project && setupMissing > 0 && (
          <div role="group" aria-label="Configuração" className="pt-1">
            <button
              type="button"
              onClick={onContinueSetup}
              className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <StatusDot tone="warning" />
              {`Falta ${setupMissing} ${setupMissing === 1 ? 'passo' : 'passos'} · continuar`}
            </button>
          </div>
        )}
        {groups && (
          <>
            {section('Esperando você', groups.waiting)}
            {section('Rodando', groups.running)}
            {section(
              'A fazer',
              groups.todo,
              groups.todoTotal > groups.todo.length ? (
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'board' })}
                    className="w-full rounded-[7px] px-2 py-1.5 text-left text-xs text-subtle-foreground hover:bg-sidebar-accent hover:text-foreground"
                  >
                    {`Ver todas (${groups.todoTotal})`}
                  </button>
                </li>
              ) : undefined
            )}
          </>
        )}
      </div>

      <div className="mt-1 border-t border-sidebar-border pt-2">{account}</div>
    </div>
  )
}

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { StatusDot } from '../components/StatusToken'
import { SearchIcon, SwitchIcon } from '../components/icons'
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
 * Coluna do projeto (ao lado do dock): projeto atual, "Buscar tarefa", o que falta configurar e as
 * listas "Esperando você", "Rodando" e "A fazer"; a conta no pé. Mostrar/esconder: Ctrl/Cmd+B.
 */
export function Sidebar({
  route,
  project,
  projects,
  groups,
  setupMissing,
  onChooseProject,
  onManageProjects,
  onSearch,
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
  onSearch(): void
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

      <button
        type="button"
        onClick={onSearch}
        aria-label="Buscar tarefa no Notion, em todos os projetos"
        className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-[7px] text-left text-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <SearchIcon className="size-4 text-subtle-foreground" />
        <span className="flex-1">Buscar tarefa</span>
        <span aria-hidden="true" className="font-mono text-[10px] text-subtle-foreground">
          Notion
        </span>
      </button>

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

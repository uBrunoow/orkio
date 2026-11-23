import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { StatusDot } from '../components/StatusToken'
import { formatKeys } from './CommandMenu'
import type { ProjectView } from '../../../shared/ipc-contract'
import { AgentsIcon, BoardIcon, SearchIcon, SettingsIcon, SwitchIcon } from '../components/icons'
import { OrkioLogo } from '../components/OrkioLogo/OrkioLogo'
import { ROUTE_TITLES, type Route } from './routes'
import { SHORTCUTS } from './shortcuts'
import type { SidebarTask, TaskGroups } from './task-groups'

const isMac = (): boolean => navigator.userAgent.includes('Mac')

/** `aria-keyshortcuts` e o atalho visível (Kbd) de uma tela do menu. */
function shortcutOf(route: Route['name']): { aria: string; keys: string } | null {
  const keys = SHORTCUTS.find((s) => s.route.name === route)?.keys
  if (!keys) return null
  return { aria: keys.replace('mod', isMac() ? 'Meta' : 'Control'), keys }
}

/** Versão do app (rodapé da marca). Só leitura; sem versão, nada aparece. */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.orkio.updates
      .status()
      .then((s) => alive && setVersion(s.currentVersion))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return version
}

/** Cor do quadradinho do projeto (iniciais), estável pelo id. */
const PROJECT_TINTS = [
  'bg-brand text-black',
  'bg-info text-black',
  'bg-ok text-black',
  'bg-warn text-black',
  'bg-danger text-black'
]
function projectTint(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PROJECT_TINTS[h % PROJECT_TINTS.length]!
}

function ProjectSquare({ project }: { project: ProjectView }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[10px] font-semibold',
        projectTint(project.id)
      )}
    >
      {project.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Linha de tarefa: ponto do estado, ID em mono apagado e o título. */
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

/** Grupo de tarefas com título em caixa-alta pequena e a contagem (mockup). */
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
      <div
        aria-hidden="true"
        className="flex justify-between px-2 pt-3 pb-1 text-[10.5px] tracking-[0.08em] text-subtle-foreground uppercase"
      >
        <span>{title}</span>
        {count !== undefined && <span className="font-mono">{count}</span>}
      </div>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  )
}

/**
 * Lista lateral (mockup + Alva Tasks): marca e versão, projeto atual, "Buscar tarefa", as tarefas
 * do projeto pelo que fazer agora e, embaixo, as três telas com o atalho e a conta.
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
  /** Conta da pessoa no rodapé (`AccountMenu`). */
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
  const version = useAppVersion()

  const section = (title: string, items: SidebarTask[], extra?: React.ReactNode): React.ReactNode =>
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

  const navItem = (name: 'board' | 'agents' | 'settings', Icon: typeof BoardIcon): React.ReactNode => {
    const sc = shortcutOf(name)
    const selected = route.name === name || (name === 'board' && route.name === 'task')
    return (
      <li>
        <button
          type="button"
          aria-current={selected ? 'page' : undefined}
          {...(sc ? { 'aria-keyshortcuts': sc.aria } : {})}
          onClick={() => onNavigate({ name })}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
            selected && 'bg-sidebar-accent text-foreground'
          )}
        >
          <Icon className={cn('size-4', selected ? 'text-foreground' : 'text-subtle-foreground')} />
          <span className="flex-1">{ROUTE_TITLES[name]}</span>
          {sc && <Kbd aria-hidden="true">{formatKeys(sc.keys)}</Kbd>}
        </button>
      </li>
    )
  }

  return (
    <nav
      aria-label="Navegação principal"
      className="flex h-full w-[248px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar px-2.5 py-3"
    >
      <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-2.5">
        <OrkioLogo variant="simple" withWordmark size={18} />
        {version && (
          <span className="ml-auto rounded-sm border border-border px-1.5 py-px font-mono text-[10px] text-subtle-foreground">
            v{version}
          </span>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Projeto atual: ${project ? project.name : 'nenhum'}. Trocar projeto`}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-[7px] text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {project && <ProjectSquare project={project} />}
          <span className="min-w-0 flex-1 truncate text-foreground">
            {project ? project.name : 'Nenhum projeto'}
          </span>
          <SwitchIcon className="size-3.5 text-subtle-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          {(projects ?? []).map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => onChooseProject(p.id)}>
              <ProjectSquare project={p} />
              <span className="truncate">{p.id === project?.id ? `${p.name} (atual)` : p.name}</span>
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

      <div role="group" aria-label="Telas">
        <ul className="flex flex-col gap-px">
          {navItem('board', BoardIcon)}
          {navItem('agents', AgentsIcon)}
          {navItem('settings', SettingsIcon)}
        </ul>
      </div>
      <div className="mt-1 border-t border-sidebar-border pt-2">{account}</div>
    </nav>
  )
}

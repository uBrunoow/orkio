import { Kbd } from '@/components/ui/kbd'
import { PageHeader } from '../components/PageHeader'
import { CommandIcon, SearchIcon, type SvgIcon } from '../components/icons'
import type { BoardTaskRef, OverviewSnapshot, OverviewTask } from '../../../shared/overview'
import { formatKeys } from './keys'
import type { Route } from './routes'
import { SCREENS } from './screens'

function Tile({
  icon: Icon,
  title,
  hint,
  keys,
  isMac,
  onClick
}: {
  icon: SvgIcon
  title: string
  hint: string
  keys?: string | undefined
  isMac: boolean
  onClick(): void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex h-full w-full items-start gap-3 rounded-xl border border-border-soft bg-card p-4 text-left outline-none hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            {title}
            {keys && (
              <Kbd aria-hidden="true" className="ml-auto">
                {formatKeys(keys, isMac)}
              </Kbd>
            )}
          </span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </span>
      </button>
    </li>
  )
}

function TaskButton({
  task,
  detail,
  tone,
  onClick
}: {
  task: OverviewTask
  detail: string
  tone: 'warn' | 'neutral'
  onClick(): void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span
          aria-hidden="true"
          className={`size-[7px] shrink-0 rounded-full ${tone === 'warn' ? 'bg-warn' : 'bg-muted-foreground'}`}
        />
        {task.displayId && (
          <span className="shrink-0 font-mono text-xs text-subtle-foreground">
            {task.displayId} ·
          </span>
        )}
        <span className="min-w-0 truncate text-foreground">{task.title ?? 'Tarefa do Notion'}</span>
        <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">{detail}</span>
      </button>
    </li>
  )
}

/**
 * Aba nova (Início): ponto de partida, nunca tela vazia. As telas do registro, a busca e a paleta,
 * e o que espera você ou está rodando agora.
 */
export function HomePage({
  snapshot,
  hasProject,
  isMac,
  onNavigate,
  onOpenTask,
  onPalette
}: {
  snapshot: OverviewSnapshot | null
  hasProject: boolean
  isMac: boolean
  onNavigate(route: Route): void
  onOpenTask(ref: BoardTaskRef): void
  onPalette(mode: 'all' | 'tasks'): void
}): React.JSX.Element {
  const waiting = snapshot?.waiting.slice(0, 6) ?? []
  const running = snapshot?.running.slice(0, 6) ?? []
  const screens = SCREENS.filter((s) => s.dock && (hasProject || !s.needsProject))
  return (
    <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-6">
      <PageHeader
        title="Por onde começar?"
        subtitle="Abra uma tela, busque uma tarefa ou faça qualquer coisa pela paleta."
      />
      <ul aria-label="Começar por" className="grid grid-cols-1 gap-3 @container sm:grid-cols-2">
        {screens.map((s) => (
          <Tile
            key={s.name}
            icon={s.icon}
            title={s.title}
            hint={s.hint}
            keys={s.keys}
            isMac={isMac}
            onClick={() => onNavigate(s.route)}
          />
        ))}
        <Tile
          icon={SearchIcon}
          title="Buscar tarefa no Notion"
          hint="Título ou ID de qualquer tarefa"
          keys="mod+p"
          isMac={isMac}
          onClick={() => onPalette('tasks')}
        />
        <Tile
          icon={CommandIcon}
          title="Fazer qualquer coisa"
          hint="Telas, tarefas, projetos e ações"
          keys="mod+k"
          isMac={isMac}
          onClick={() => onPalette('all')}
        />
      </ul>
      {(waiting.length > 0 || running.length > 0) && (
        <section
          aria-label="Agora"
          className="overflow-hidden rounded-xl border border-border-soft"
        >
          <h2 className="border-b border-border-soft bg-surface px-3 py-2 text-2xs tracking-wider text-subtle-foreground uppercase">
            Agora
          </h2>
          <ul className="divide-y divide-border-soft">
            {waiting.map((w) => (
              <TaskButton
                key={w.key}
                task={w.task}
                detail={w.what}
                tone="warn"
                onClick={() =>
                  onOpenTask({
                    projectId: w.task.projectId,
                    taskId: w.task.taskId,
                    section: w.section
                  })
                }
              />
            ))}
            {running.map((r) => (
              <TaskButton
                key={r.key}
                task={r.task}
                detail={r.state === 'queued' ? `Na fila · ${r.label}` : r.label}
                tone="neutral"
                onClick={() =>
                  onOpenTask({
                    projectId: r.task.projectId,
                    taskId: r.task.taskId,
                    section: r.section
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

import type { BoardTaskRef } from '../../../shared/ipc-contract'
import { PR_REASON_LABEL, type OverviewSnapshot, type OverviewTask } from '../../../shared/overview'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { BellIcon } from '../components/icons'

function taskLabel(task: OverviewTask): { id: string | null; title: string } {
  return { id: task.displayId, title: task.title ?? 'Tarefa do Notion' }
}

/**
 * Sino da barra superior: tudo que espera você em todos os projetos e as PRs com atenção. Caixa
 * com borda e o número em amarelo (mockup). O número também vai para o ícone do app (pelo main).
 */
export function WaitingBell({
  snapshot,
  onOpen
}: {
  snapshot: OverviewSnapshot | null
  onOpen(ref: BoardTaskRef): void
}): React.JSX.Element {
  const waiting = snapshot?.waiting ?? []
  const prs = snapshot?.prs ?? []
  const label = waiting.length > 0 ? `${waiting.length} esperando você` : 'Nada esperando você'

  const byProject = new Map<string, { name: string; items: typeof waiting }>()
  for (const item of waiting) {
    const group = byProject.get(item.task.projectId) ?? { name: item.task.projectName, items: [] }
    group.items.push(item)
    byProject.set(item.task.projectId, group)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <BellIcon className="size-3.5" />
        {waiting.length > 0 ? (
          <span aria-hidden="true">
            <b className="font-semibold text-warn">{waiting.length}</b> esperando
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[480px] w-[360px] overflow-y-auto">
        {[...byProject.entries()].map(([id, group], i) => (
          <DropdownMenuGroup key={id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-2xs tracking-wider text-subtle-foreground uppercase">
              {group.name}
            </DropdownMenuLabel>
            {group.items.map((item) => {
              const t = taskLabel(item.task)
              return (
                <DropdownMenuItem
                  key={`${item.task.taskId}:${item.what}`}
                  onSelect={() =>
                    onOpen({
                      projectId: item.task.projectId,
                      taskId: item.task.taskId,
                      section: item.section
                    })
                  }
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="size-[7px] shrink-0 rounded-full bg-warn" aria-hidden="true" />
                    {t.id && (
                      <span className="font-mono text-xs text-subtle-foreground">{t.id} ·</span>
                    )}
                    <span className="truncate">{t.title}</span>
                  </span>
                  <span className="pl-4 text-xs text-muted-foreground">{item.what}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        ))}
        {prs.length > 0 && (
          <DropdownMenuGroup>
            {byProject.size > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-2xs tracking-wider text-subtle-foreground uppercase">
              PRs com atenção
            </DropdownMenuLabel>
            {prs.map((pr) => (
              <DropdownMenuItem
                key={`${pr.task.taskId}:${pr.number}`}
                onSelect={() => onOpen({ projectId: pr.task.projectId, taskId: pr.task.taskId })}
                className="flex-col items-start gap-0.5"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-subtle-foreground">#{pr.number}</span>
                  <span className="truncate">
                    {pr.task.title ?? pr.task.displayId ?? 'Tarefa'}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {pr.reasons.map((r) => PR_REASON_LABEL[r]).join(' · ')}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {byProject.size === 0 && prs.length === 0 && (
          <DropdownMenuItem disabled className={cn('text-muted-foreground')}>
            Nada esperando você
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

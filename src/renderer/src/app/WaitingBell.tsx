import { useMemo, useState } from 'react'
import {
  PR_REASON_LABEL,
  type BoardTaskRef,
  type OverviewSnapshot,
  type OverviewTask
} from '../../../shared/overview'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { BellIcon, CleanIcon, DoneIcon } from '../components/icons'
import { Timestamp } from '../components/Timestamp'
import { useSource } from '../lib/ipc'
import { useSources } from './sources'
import { finishedItems } from './attention'

/** Preferência local: até quando o "Concluído" já foi limpo. */
const CLEARED_KEY = 'orkio.bell.clearedAt'
/** Sem "Limpar" ainda: mostra o que terminou nas últimas 24 h. */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

function readCleared(): string {
  return (
    window.localStorage.getItem(CLEARED_KEY) ??
    new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString()
  )
}

function taskLabel(task: OverviewTask): { id: string | null; title: string } {
  return { id: task.displayId, title: task.title ?? 'Tarefa do Notion' }
}

function TaskLine({ task }: { task: OverviewTask }): React.JSX.Element {
  const t = taskLabel(task)
  return (
    <>
      {t.id && <span className="font-mono text-xs text-subtle-foreground">{t.id} ·</span>}
      <span className="truncate">{t.title}</span>
    </>
  )
}

const heading = 'flex items-center justify-between label-caps'

/**
 * Sino de atenção: "Precisa de você" (a regra única de esperando você, de todos os projetos, e as
 * PRs com atenção) e "Concluído" (fluxos e execuções que terminaram desde o último "Limpar"). Só a
 * contagem do que espera você usa a cor de destaque; ela também vai para o ícone do app (main).
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
  const { finished: source } = useSources()
  const activity = useSource(source, '').value
  const [clearedAt, setClearedAt] = useState(readCleared)
  const finished = useMemo(() => finishedItems(activity ?? [], clearedAt), [activity, clearedAt])
  const label = waiting.length > 0 ? `${waiting.length} esperando você` : 'Nada esperando você'

  const clear = (): void => {
    const now = new Date().toISOString()
    window.localStorage.setItem(CLEARED_KEY, now)
    setClearedAt(now)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="relative flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <BellIcon className="size-3.5" />
        {waiting.length > 0 ? (
          <span aria-hidden="true">
            <b className="font-semibold text-warn">{waiting.length}</b> esperando
          </span>
        ) : finished.length > 0 ? (
          <span
            aria-hidden="true"
            data-testid="bell-finished-dot"
            className="absolute -top-0.5 -right-0.5 size-[7px] rounded-full bg-muted-foreground"
          />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[520px] w-[380px] overflow-y-auto">
        <DropdownMenuGroup aria-label="Precisa de você">
          <DropdownMenuLabel className={heading}>
            <span>Precisa de você</span>
            {waiting.length > 0 && <span className="font-mono">{waiting.length}</span>}
          </DropdownMenuLabel>
          {waiting.map((item) => (
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
                <TaskLine task={item.task} />
              </span>
              <span className="pl-4 text-xs text-muted-foreground">
                {item.what} · {item.task.projectName}
              </span>
            </DropdownMenuItem>
          ))}
          {prs.map((pr) => (
            <DropdownMenuItem
              key={`${pr.task.taskId}:${pr.number}`}
              onSelect={() => onOpen({ projectId: pr.task.projectId, taskId: pr.task.taskId })}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-subtle-foreground">PR #{pr.number}</span>
                <span className="truncate">{pr.task.title ?? pr.task.displayId ?? 'Tarefa'}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {pr.reasons.map((r) => PR_REASON_LABEL[r]).join(' · ')}
              </span>
            </DropdownMenuItem>
          ))}
          {waiting.length === 0 && prs.length === 0 && (
            <DropdownMenuItem disabled className="text-muted-foreground">
              Nada esperando você
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label="Concluído">
          <DropdownMenuLabel className={heading}>
            <span>Concluído</span>
            {finished.length > 0 && <span className="font-mono">{finished.length}</span>}
          </DropdownMenuLabel>
          {finished.map((item) => (
            <DropdownMenuItem
              key={item.key}
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
                <DoneIcon className="size-3.5 text-muted-foreground" />
                <TaskLine task={item.task} />
              </span>
              <span className="pl-5.5 text-xs text-muted-foreground">
                {item.text} · <Timestamp value={item.at} /> · {item.task.projectName}
              </span>
            </DropdownMenuItem>
          ))}
          {finished.length === 0 ? (
            <DropdownMenuItem disabled className="text-muted-foreground">
              Nada concluído por enquanto
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              // Fica aberto: a lista some e a pessoa vê que limpou.
              onSelect={(e) => {
                e.preventDefault()
                clear()
              }}
              className="text-muted-foreground"
            >
              <CleanIcon />
              Limpar concluídos
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

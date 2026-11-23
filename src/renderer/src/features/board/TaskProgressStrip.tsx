import { cn } from '@/lib/utils'
import { DoneIcon, DotIcon, ProblemIcon, TodoIcon } from '../../components/icons'
import type { Milestone } from './task-progress'

const STATE_TEXT: Record<Milestone['state'], string> = {
  done: 'feito',
  current: 'agora',
  waiting: 'esperando você',
  problem: 'precisa de atenção',
  todo: 'ainda não'
}

/**
 * "Em que pé está": os marcos da tarefa numa linha (Spec, Plano, Código, PR, Revisão, Merge).
 * Feito = ícone verde; atual = ponto laranja (amarelo se espera você); problema = alerta rosa;
 * o resto em cinza. `compact` (painel do Quadro): só o nome, o detalhe vai no nome acessível.
 */
export function TaskProgressStrip({
  milestones,
  compact = false
}: {
  milestones: readonly Milestone[]
  compact?: boolean
}): React.JSX.Element {
  const marks = milestones.map((m) => (
    <li
      key={m.key}
      aria-label={`${m.label}: ${STATE_TEXT[m.state]}${m.detail !== '—' ? ` (${m.detail})` : ''}`}
      data-testid={`progress-${m.key}`}
      data-state={m.state}
      className="flex min-w-0 flex-col"
    >
      <span className="flex items-center gap-1">
        {m.state === 'done' ? (
          <DoneIcon className="size-3.5 text-ok" />
        ) : m.state === 'problem' ? (
          <ProblemIcon className="size-3.5 text-danger" />
        ) : m.state === 'current' ? (
          <DotIcon className="size-3.5 text-brand" />
        ) : m.state === 'waiting' ? (
          <DotIcon className="size-3.5 text-warn" />
        ) : (
          <TodoIcon className="size-3.5 text-subtle-foreground" />
        )}
        <span
          className={cn(
            'font-medium',
            compact ? 'text-xs' : 'text-sm',
            m.state === 'todo' ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {m.label}
        </span>
      </span>
      {!compact && (
        <span className="truncate text-xs text-muted-foreground">
          {m.detail === '—' ? 'ainda não' : m.detail}
        </span>
      )}
    </li>
  ))
  if (compact) {
    return (
      <ul aria-label="Andamento da tarefa" className="flex flex-wrap gap-3">
        {marks}
      </ul>
    )
  }
  return (
    <ul
      aria-label="Andamento da tarefa"
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}
    >
      {marks}
    </ul>
  )
}

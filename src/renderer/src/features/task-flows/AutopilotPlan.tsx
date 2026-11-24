import { DoneIcon, DotIcon, ProblemIcon, TodoIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { planProgress, type PlanState, type PlanStep } from './flow-plan'

/** O que o piloto automático faz, numa frase (bloco do fluxo e popover do plano). */
export const AUTOPILOT_TEXT =
  'Piloto automático: o Orkio manda cada passo para o Claude Code e segue sozinho. Ele para quando precisar de você.'

const STATE: Record<PlanState, { label: string; icon: typeof DoneIcon; className: string }> = {
  done: { label: 'feito', icon: DoneIcon, className: 'text-ok' },
  current: { label: 'agora', icon: DotIcon, className: 'text-brand' },
  waiting: { label: 'esperando você', icon: DotIcon, className: 'text-warn' },
  failed: { label: 'parou aqui', icon: ProblemIcon, className: 'text-danger' },
  skipped: { label: 'pulado', icon: TodoIcon, className: 'text-subtle-foreground' },
  next: { label: 'a seguir', icon: TodoIcon, className: 'text-subtle-foreground' },
  unreached: { label: 'não precisou', icon: TodoIcon, className: 'text-subtle-foreground' }
}

/**
 * Plano do piloto automático: os passos do fluxo como a lista de tarefas de uma sessão do Claude
 * Code (feito, agora, esperando você, a seguir). A conversa de cada passo fica logo acima, na
 * sessão; aqui é o mapa de onde o fluxo está e do que ainda vai acontecer sem você digitar nada.
 */
export function AutopilotPlan({ plan }: { plan: readonly PlanStep[] }): React.JSX.Element {
  const { done, total } = planProgress(plan)
  return (
    <div
      role="group"
      aria-label="Plano do piloto automático"
      className="flex flex-col gap-1.5 rounded-lg border border-border-soft bg-surface px-3 py-2.5"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-foreground">Plano</span>
        <span className="tabular text-muted-foreground" data-testid="autopilot-progress">
          {done} de {total} {total === 1 ? 'passo feito' : 'passos feitos'}
        </span>
      </div>
      <ul aria-label="Passos do plano" className="flex flex-col gap-1">
        {plan.map((p) => {
          const s = STATE[p.state]
          const Icon = s.icon
          const extra = p.visits > 1 ? ` · ${p.visits}ª vez` : ''
          const strong = p.state === 'current' || p.state === 'waiting'
          const dim = p.state === 'next' || p.state === 'unreached' || p.state === 'skipped'
          return (
            <li key={p.id} data-state={p.state} className="flex items-start gap-2">
              <Icon className={cn('mt-0.5 size-3.5', s.className)} />
              <div className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'text-sm',
                    strong ? 'font-medium text-foreground' : dim ? 'text-muted-foreground' : ''
                  )}
                >
                  {p.name}
                </span>
                <span className="text-xs text-subtle-foreground">
                  {p.detail} · {s.label}
                  {extra}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { DoneIcon, ProblemIcon } from '../../components/icons'
import { PLAN_TRIGGER_ATTR, type PhaseState, type TaskPhase } from './task-phases'

const SUFFIX: Record<PhaseState, string> = {
  done: 'feita',
  current: 'agora',
  waiting: 'esperando você',
  failed: 'parou',
  next: 'a seguir'
}

/** Fase em destaque: o tom diz se o agente trabalha (laranja), espera você ou parou. */
const PHASE_CLASS: Record<PhaseState, string> = {
  done: 'text-muted-foreground',
  current: 'bg-brand-tint text-brand-tint-foreground',
  waiting: 'bg-warn-tint text-warn',
  failed: 'bg-danger-tint text-danger',
  next: 'text-subtle-foreground'
}

/** Ponto na fase de agora (laranja), esperando você (amarelo). */
const DOT_CLASS: Partial<Record<PhaseState, string>> = {
  current: 'bg-brand',
  waiting: 'bg-warn'
}

/** Fases que mostram o rótulo na barra compacta (as outras ficam só com ✓ ou um ponto). */
const COMPACT_LABEL = new Set<PhaseState>(['current', 'waiting', 'failed'])

/**
 * Fases da tarefa na barra do topo (Spec → Plano → Implementar → Revisão → PR, ou as colunas):
 * uma caixa só, a fase de agora em destaque, as feitas com ✓ e as próximas apagadas.
 * `compact` (janela estreita): só a fase de agora (ou a que espera/parou) mostra o rótulo; as
 * feitas viram ✓ e as próximas um ponto. O nome acessível de cada fase não muda.
 * Com `plan` (fluxo vivo), um botão sobre a barra abre o plano do piloto automático (popover).
 */
export function TaskPhaseBar({
  phases,
  compact = false,
  plan = null
}: {
  phases: readonly TaskPhase[]
  compact?: boolean
  plan?: {
    label: string
    open: boolean
    onOpenChange(open: boolean): void
    children: React.ReactNode
  } | null
}): React.JSX.Element | null {
  if (phases.length === 0) return null
  const list = (
    <ul
      role="list"
      aria-label="Fases da tarefa"
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border p-0.5"
    >
      {phases.map((phase) => {
        const dot = DOT_CLASS[phase.state]
        const short = compact && !COMPACT_LABEL.has(phase.state)
        return (
          <li
            key={phase.id}
            role="listitem"
            aria-label={`${phase.label}: ${SUFFIX[phase.state]}`}
            title={short ? phase.label : undefined}
            data-phase-state={phase.state}
            className={cn(
              'flex items-center gap-1.5 rounded-md py-1 font-mono text-[11.5px] leading-4 whitespace-nowrap',
              short ? 'px-1.5' : 'px-2.5',
              PHASE_CLASS[phase.state]
            )}
          >
            {phase.state === 'done' && <DoneIcon className="size-3 text-ok" />}
            {phase.state === 'failed' && <ProblemIcon className="size-3" />}
            {dot && (
              <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot)} />
            )}
            {short && phase.state === 'next' && (
              <span
                aria-hidden="true"
                className="mx-1 size-1 shrink-0 rounded-full bg-subtle-foreground"
              />
            )}
            <span className={cn(short && 'sr-only')}>{phase.label}</span>
          </li>
        )
      })}
    </ul>
  )
  if (!plan) return list
  return (
    <Popover open={plan.open} onOpenChange={plan.onOpenChange}>
      {/* O botão cobre a barra (a lista continua legível por leitores de tela). */}
      <div className="relative shrink-0">
        {list}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={plan.label}
            aria-haspopup="dialog"
            aria-expanded={plan.open}
            className="absolute inset-0 cursor-pointer rounded-lg outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="end"
        aria-label="Plano do fluxo"
        // "Ver plano" (fim da conversa) também abre o popover: clicar nele com o popover aberto
        // não conta como clique fora (fecharia e reabriria, piscando).
        onInteractOutside={(e) => {
          const target = e.target
          if (target instanceof Element && target.closest(`[${PLAN_TRIGGER_ATTR}]`)) {
            e.preventDefault()
          }
        }}
        className="flex max-h-[min(70vh,520px)] w-[360px] flex-col gap-3 overflow-y-auto p-3.5"
      >
        {plan.children}
      </PopoverContent>
    </Popover>
  )
}

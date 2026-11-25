import { cn } from '@/lib/utils'
import { CheckIcon, ListIcon, PermissionIcon, PlayIcon } from '../../components/icons'
import { RUN_MODES, RUN_MODE_TEXT, type RunMode } from '../../../../shared/task-setup'

const MODE_ICON: Record<RunMode, React.ComponentType<{ className?: string }>> = {
  quick: PlayIcon,
  approval: PermissionIcon,
  steps: ListIcon
}

/** Valor "herdar" (a coluna ou o fluxo dela decidem). */
export const INHERIT = 'inherit' as const
export type ModeChoice = RunMode | typeof INHERIT

/**
 * "Como deve rodar?" em cartões com frase comum (não um select técnico). Grupo de rádio: setas
 * trocam a escolha, Tab sai do grupo. `inherit` (opcional) = o primeiro cartão, "Como a coluna
 * manda", com o que ela decide.
 */
export function ModeCards({
  value,
  onChange,
  inherit,
  disabled,
  label = 'Como deve rodar?',
  compact
}: {
  value: ModeChoice
  onChange(value: ModeChoice): void
  /** Texto do cartão "herdar" (ex.: "Coluna Em andamento: Com aprovação"); ausente = sem ele. */
  inherit?: { title: string; detail: string } | undefined
  disabled?: boolean
  label?: string
  /** Só o título e a frase (painel estreito). */
  compact?: boolean
}): React.JSX.Element {
  const options: { value: ModeChoice; title: string; phrase: string; steps: string | null }[] = [
    ...(inherit
      ? [{ value: INHERIT, title: inherit.title, phrase: inherit.detail, steps: null }]
      : []),
    ...RUN_MODES.map((m) => ({
      value: m,
      title: RUN_MODE_TEXT[m].label,
      phrase: RUN_MODE_TEXT[m].phrase,
      steps: RUN_MODE_TEXT[m].steps
    }))
  ]
  const move = (from: number, delta: number): void => {
    const next = options[(from + delta + options.length) % options.length]!
    onChange(next.value)
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-mode-card="${next.value}"]`)?.focus()
    })
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3')}
    >
      {options.map((o, i) => {
        const checked = o.value === value
        const Icon = o.value === INHERIT ? CheckIcon : MODE_ICON[o.value]
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-mode-card={o.value}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={o.steps ?? undefined}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault()
                move(i, 1)
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault()
                move(i, -1)
              }
            }}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
              'disabled:cursor-not-allowed disabled:opacity-60',
              checked
                ? 'border-foreground/40 bg-muted text-foreground'
                : 'border-border-soft bg-card text-muted-foreground hover:bg-muted/60',
              o.value === INHERIT && !compact && 'sm:col-span-3'
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              {o.title}
            </span>
            <span className="text-xs text-muted-foreground">{o.phrase}</span>
          </button>
        )
      })}
    </div>
  )
}

import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface ChoiceCard<T extends string> {
  value: T
  title: string
  /** Frase comum do cartão (o termo técnico vai no `hint`, um passo mais fundo). */
  phrase: string
  /** Detalhe no `title` (tooltip nativo). */
  hint?: string
}

/**
 * Escolha em cartões com frase comum (no lugar de um select técnico). Grupo de rádio acessível:
 * setas trocam a escolha, Tab sai do grupo, foco visível. Mesmo padrão dos cartões do "Como deve
 * rodar?" (`ModeCards`), para qualquer escolha curta (autonomia, escopo da nota...).
 */
export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  columns = 3,
  className
}: {
  label: string
  value: T
  options: readonly ChoiceCard<T>[]
  onChange(value: T): void
  disabled?: boolean
  columns?: 1 | 2 | 3
  className?: string
}): React.JSX.Element {
  const group = useId()
  const move = (from: number, delta: number): void => {
    const next = options[(from + delta + options.length) % options.length]!
    onChange(next.value)
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-choice-group="${CSS.escape(group)}"][data-choice="${CSS.escape(next.value)}"]`
        )
        ?.focus()
    })
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'grid gap-2',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-3',
        className
      )}
    >
      {options.map((o, i) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-choice-group={group}
            data-choice={o.value}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={o.hint}
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
                : 'border-border-soft bg-card text-muted-foreground hover:bg-muted/60'
            )}
          >
            <span className="text-sm font-medium text-foreground">{o.title}</span>
            <span className="text-xs text-muted-foreground">{o.phrase}</span>
          </button>
        )
      })}
    </div>
  )
}

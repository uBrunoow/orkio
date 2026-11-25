import { cn } from '@/lib/utils'
import { useRovingRadio } from './ChoiceCards'

export interface EffortStop<T extends string> {
  value: T
  label: string
}

/**
 * Régua de raciocínio: pontos numa linha, do mais leve ao mais forte; o escolhido vira uma bolinha
 * maior com o nome em cima. Grupo de rádio por baixo (setas trocam, Tab sai), então teclado e
 * leitor de tela funcionam como em qualquer escolha.
 */
export function EffortSlider<T extends string>({
  label,
  value,
  stops,
  onChange,
  className
}: {
  label: string
  value: T
  stops: readonly EffortStop<T>[]
  onChange(value: T): void
  className?: string
}): React.JSX.Element {
  const { group, keyDown } = useRovingRadio(stops, onChange)
  const at = Math.max(
    0,
    stops.findIndex((s) => s.value === value)
  )
  const fill = stops.length > 1 ? (at / (stops.length - 1)) * 100 : 0
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          {label}
        </span>
        <span className="text-xs text-foreground">{stops[at]?.label}</span>
      </div>
      <div role="radiogroup" aria-label={label} className="relative flex h-6 items-center">
        {/* Trilho e o trecho até o escolhido. */}
        <span aria-hidden="true" className="absolute inset-x-2 h-px bg-border" />
        <span
          aria-hidden="true"
          className="absolute left-2 h-px bg-foreground/50 transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `calc((100% - 1rem) * ${fill / 100})` }}
        />
        <div className="relative flex w-full items-center justify-between">
          {stops.map((s, i) => {
            const checked = i === at
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={s.label}
                title={s.label}
                data-choice-group={group}
                data-choice={s.value}
                tabIndex={checked ? 0 : -1}
                onClick={() => onChange(s.value)}
                onKeyDown={(e) => keyDown(e, i)}
                className="group/stop grid size-4 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    'block rounded-full transition-all duration-150 motion-reduce:transition-none',
                    checked
                      ? 'size-3.5 bg-foreground shadow-[0_1px_2px_0_color-mix(in_oklab,var(--foreground)_25%,transparent)]'
                      : i < at
                        ? 'size-1.5 bg-foreground/60 group-hover/stop:size-2'
                        : 'size-1.5 bg-subtle-foreground group-hover/stop:size-2'
                  )}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface ChoiceCard<T extends string> {
  value: T
  title: string
  /** Frase comum do cartão (o termo técnico vai no `hint`, um passo mais fundo). */
  phrase: string
  /** Detalhe no `title` (tooltip nativo). */
  hint?: string
  /** Ícone antes do título (ex.: níveis de permissão). */
  icon?: React.ComponentType<{ className?: string }>
}

/** Grupo de rádio com foco itinerante: setas trocam a escolha e levam o foco junto. */
export function useRovingRadio<T extends string>(
  options: readonly { value: T }[],
  onChange: (value: T) => void
): { group: string; keyDown(e: React.KeyboardEvent, index: number): void } {
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
  return {
    group,
    keyDown(e, i) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        move(i, 1)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        move(i, -1)
      }
    }
  }
}

/** Aparência de um cartão escolhível (ChoiceCards, PictureChoices e os cartões do "Como deve rodar?"). */
export function choiceCardClass(checked: boolean): string {
  return cn(
    'rounded-lg border text-left transition-colors',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
    'disabled:cursor-not-allowed disabled:opacity-60',
    checked
      ? 'border-brand/70 bg-brand-tint/45 text-foreground ring-1 ring-brand/25'
      : 'border-border-soft bg-card text-muted-foreground hover:border-border hover:bg-muted/60'
  )
}

/** Bolinha de rádio do cartão: vazada; escolhida, laranja com o miolo. */
export function ChoiceMark({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'ml-auto grid size-4 shrink-0 place-items-center rounded-full border transition-colors motion-reduce:transition-none',
        checked ? 'border-brand bg-brand' : 'border-border bg-transparent'
      )}
    >
      {checked && <span className="size-1.5 rounded-full bg-primary-foreground" />}
    </span>
  )
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
  const { group, keyDown } = useRovingRadio(options, onChange)
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
            onKeyDown={(e) => keyDown(e, i)}
            className={cn('flex flex-col items-start gap-1 px-3 py-2.5', choiceCardClass(checked))}
          >
            <span className="flex w-full items-center gap-2 text-sm font-medium text-foreground">
              {o.icon && (
                <o.icon
                  className={cn(
                    'size-3.5 shrink-0',
                    checked ? 'text-brand' : 'text-muted-foreground'
                  )}
                />
              )}
              {o.title}
              <ChoiceMark checked={checked} />
            </span>
            <span className="text-xs text-muted-foreground">{o.phrase}</span>
          </button>
        )
      })}
    </div>
  )
}

export interface PictureChoice<T extends string> {
  value: T
  label: string
  /** Desenho da opção (miniatura do layout, prévia do fundo...). Decorativo: o nome é o `label`. */
  picture: React.ReactNode
  hint?: string
}

/**
 * Escolha por figura: cartões com uma miniatura em cima e o nome embaixo (fundo da tela, arranjo
 * dos painéis). Mesmo grupo de rádio e o mesmo visual de seleção dos `ChoiceCards`.
 */
export function PictureChoices<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className
}: {
  label: string
  value: T
  options: readonly PictureChoice<T>[]
  onChange(value: T): void
  /** `md` = cartões largos (prévias); `sm` = miniaturas pequenas numa linha de ajuste. */
  size?: 'sm' | 'md'
  className?: string
}): React.JSX.Element {
  const { group, keyDown } = useRovingRadio(options, onChange)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        size === 'md' ? 'grid grid-cols-2 gap-2 sm:grid-cols-4' : 'flex flex-wrap gap-1.5',
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
            aria-label={o.label}
            data-choice-group={group}
            data-choice={o.value}
            tabIndex={checked ? 0 : -1}
            title={o.hint}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => keyDown(e, i)}
            className={cn(
              'group/pic flex flex-col overflow-hidden',
              size === 'md' ? 'gap-0' : 'w-24 gap-1.5 p-1.5',
              choiceCardClass(checked)
            )}
          >
            <span aria-hidden="true" className={cn('block', size === 'md' && 'h-20 w-full')}>
              {o.picture}
            </span>
            <span
              className={cn(
                'flex items-center justify-between gap-1 text-xs',
                size === 'md' ? 'border-t border-border-soft px-3 py-2' : 'px-0.5',
                checked ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {o.label}
              {checked && size === 'md' && <ChoiceMark checked />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

import { cn } from '@/lib/utils'
import { ChoiceMark, choiceCardClass, useRovingRadio } from '../../components/ChoiceCards'
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
  const { group, keyDown } = useRovingRadio(options, onChange)
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
            data-choice-group={group}
            data-choice={o.value}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={o.steps ?? undefined}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => keyDown(e, i)}
            className={cn(
              'flex flex-col items-start gap-1 px-3 py-2.5',
              choiceCardClass(checked),
              o.value === INHERIT && !compact && 'sm:col-span-3'
            )}
          >
            <span className="flex w-full items-center gap-2 text-sm font-medium text-foreground">
              <Icon
                className={cn(
                  'size-3.5 shrink-0',
                  checked ? 'text-brand' : 'text-muted-foreground'
                )}
              />
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

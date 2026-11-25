import { cn } from '@/lib/utils'
import type { AgentColor } from '../../../../shared/agent'
import { choiceCardClass } from '../../components/ChoiceCards'
import { CheckIcon } from '../../components/icons'
import { AgentAvatar } from './AgentAvatar'

export interface CheckItem {
  key: string
  name: string
  description?: string | undefined
  /** Agente: rosto com a cor dele. Sem `face`, usa `icon`. */
  face?: { color: AgentColor | undefined; seed: string } | undefined
  icon?: React.ReactNode
}

/** Caixinha de marcar do cartão: vazada; marcada, laranja com o ✓ (par do `ChoiceMark`). */
function CheckMark({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded border transition-colors motion-reduce:transition-none',
        checked ? 'border-brand bg-brand text-primary-foreground' : 'border-border bg-transparent'
      )}
    >
      {checked && <CheckIcon className="size-3" />}
    </span>
  )
}

/**
 * Várias escolhas em cartões 2×2 (agentes com o rosto, servidores com o ícone), marcadas com o
 * mesmo foco laranja dos cartões de escolha. Cada cartão é um `checkbox` com o nome acessível.
 */
export function CheckCardGrid({
  label,
  items,
  checked,
  onToggle,
  disabled
}: {
  label: string
  items: readonly CheckItem[]
  checked(key: string): boolean
  onToggle(key: string, on: boolean): void
  disabled?: boolean | undefined
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((it) => {
        const on = checked(it.key)
        return (
          <button
            key={it.key}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={it.name}
            disabled={disabled}
            onClick={() => onToggle(it.key, !on)}
            className={cn(choiceCardClass(on), 'flex items-center gap-3 px-3 py-2.5')}
          >
            {it.face ? (
              <AgentAvatar
                name={it.name}
                color={it.face.color ?? 'yellow'}
                seed={it.face.seed}
                size="md"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-border-soft bg-muted text-muted-foreground"
              >
                {it.icon}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  'truncate text-sm',
                  on ? 'font-medium text-foreground' : 'text-foreground'
                )}
              >
                {it.name}
              </span>
              {it.description && (
                <span className="line-clamp-1 text-xs text-muted-foreground">{it.description}</span>
              )}
            </span>
            <CheckMark checked={on} />
          </button>
        )
      })}
    </div>
  )
}

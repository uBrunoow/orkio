import * as React from 'react'
import { IconCheck, IconSelector } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'

export interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
  group?: string
}

/**
 * Select do Orkio. Não usa o Select do Radix: ele sempre trava a rolagem com react-remove-scroll
 * e injeta `<style>` (quebra a CSP estrita). Aqui é Popover (não modal) + lista do cmdk.
 *
 * Acessibilidade: gatilho `combobox` com o nome = `aria-label` (o rótulo); o valor aparece como
 * texto do gatilho; cada opção é `option` com nome = rótulo (+ descrição).
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Escolha…',
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  id,
  size = 'default',
  disabled,
  invalid,
  hasSearch,
  searchPlaceholder = 'Buscar…',
  clearLabel,
  onClear,
  isLoading,
  emptyText = 'Nada encontrado.',
  className,
  contentClassName
}: {
  value?: string | null | undefined
  onChange(value: string): void
  options: readonly SelectOption[]
  placeholder?: string
  'aria-label': string
  'aria-describedby'?: string | undefined
  id?: string | undefined
  size?: 'default' | 'sm'
  disabled?: boolean | undefined
  invalid?: boolean | undefined
  hasSearch?: boolean | undefined
  searchPlaceholder?: string
  /** Com `onClear`: primeira opção que limpa (ex.: "Todas as prioridades"). */
  clearLabel?: string
  onClear?: (() => void) | undefined
  isLoading?: boolean | undefined
  emptyText?: string
  className?: string
  contentClassName?: string
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const selected = options.find((o) => o.value === value)
  const groups = React.useMemo(() => {
    const map = new Map<string, SelectOption[]>()
    for (const o of options) {
      const key = o.group ?? ''
      map.set(key, [...(map.get(key) ?? []), o])
    }
    return [...map.entries()]
  }, [options])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card text-left text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
            size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
            className
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <IconSelector className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-(--radix-popover-trigger-width) min-w-56 p-0', contentClassName)}
      >
        <Command>
          {hasSearch && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList id={listId} aria-label={ariaLabel}>
            {isLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">Carregando…</div>
            ) : (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            {onClear && clearLabel && (
              <CommandGroup>
                <CommandItem
                  value={`__clear__ ${clearLabel}`}
                  onSelect={() => {
                    onClear()
                    setOpen(false)
                  }}
                >
                  <span className="text-muted-foreground">{clearLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([group, items]) => (
              <CommandGroup key={group || '_'} {...(group ? { heading: group } : {})}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    disabled={o.disabled ?? false}
                    onSelect={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{o.label}</span>
                      {o.description && (
                        <span className="truncate text-xs text-muted-foreground">
                          {' '}
                          {o.description}
                        </span>
                      )}
                    </span>
                    <IconCheck
                      aria-hidden="true"
                      className={cn('size-3.5', o.value === value ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

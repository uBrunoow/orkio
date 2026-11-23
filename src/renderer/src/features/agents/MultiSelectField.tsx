import { useState } from 'react'
import { Field, CheckboxField } from '@/components/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { SwitchIcon } from '../../components/icons'

export interface MultiOption {
  value: string
  label: string
}

/**
 * Escolha de vários valores (no lugar do MultiSelector da Astryx): o gatilho mostra os rótulos
 * escolhidos e abre uma lista de caixas de seleção (papel `checkbox`), com busca opcional.
 */
export function MultiSelectField({
  label,
  description,
  placeholder,
  options,
  value,
  hasSearch,
  onChange,
  className
}: {
  label: string
  description?: React.ReactNode
  placeholder: string
  options: readonly MultiOption[]
  value: readonly string[]
  hasSearch?: boolean
  onChange(value: string[]): void
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const chosen = options.filter((o) => value.includes(o.value))
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  return (
    <Field label={label} description={description} className={className}>
      {({ id, describedBy }) => (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) setQuery('')
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              aria-label={label}
              aria-describedby={describedBy}
              aria-haspopup="dialog"
              className="inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className={cn('truncate', chosen.length === 0 && 'text-muted-foreground')}>
                {chosen.length === 0 ? placeholder : chosen.map((o) => o.label).join(', ')}
              </span>
              <SwitchIcon className="size-3.5 text-subtle-foreground" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex w-(--radix-popover-trigger-width) min-w-56 flex-col gap-2 p-2"
          >
            {hasSearch && (
              <Input
                type="search"
                aria-label={`Buscar em ${label}`}
                placeholder="Buscar…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-7 text-xs"
              />
            )}
            <div
              role="group"
              aria-label={label}
              className="flex max-h-64 flex-col gap-2 overflow-y-auto px-1 py-1"
            >
              {shown.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">Nada encontrado.</p>
              ) : (
                shown.map((o) => (
                  <CheckboxField
                    key={o.value}
                    label={o.label}
                    checked={value.includes(o.value)}
                    onChange={(on) =>
                      onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))
                    }
                  />
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </Field>
  )
}

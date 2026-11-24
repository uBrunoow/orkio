import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentedControl, TextField } from '@/components/form'
import { cn } from '@/lib/utils'
import {
  CLAUDE_MODELS,
  EFFORTS,
  EFFORT_LABELS,
  isEffort,
  isModelName,
  runtimeLabel,
  type RuntimeChoice
} from '../../../../shared/agent-runtime'
import { BrainIcon, CheckIcon } from '../../components/icons'
import { useClaudeStatus } from './useClaudeStatus'

const MODEL_ERROR = 'Use letras minúsculas, números, ponto e hífen.'
const DEFAULT_LABEL = 'Padrão do Claude Code'

/** Rótulo do que está escolhido (ou do herdado, quando nada foi escolhido). */
export function pickerLabel(value: Partial<RuntimeChoice>, inheritLabel?: string): string {
  if (value.model === undefined && value.effort === undefined) return inheritLabel ?? DEFAULT_LABEL
  return runtimeLabel({ model: value.model ?? null, effort: value.effort ?? null })
}

/**
 * Seletor de modelo e raciocínio do Claude Code. `undefined` num campo = herda (agente/padrão);
 * `null` = padrão do Claude Code explícito. Popover não modal + lista do cmdk (nada de Radix Select).
 */
export function RuntimePicker({
  value,
  onChange,
  supportsEffort,
  inheritLabel,
  title,
  describedBy,
  className
}: {
  value: Partial<RuntimeChoice>
  onChange(value: Partial<RuntimeChoice>): void
  supportsEffort: boolean
  /** Ex.: "Do agente: Opus". Aparece como primeira opção e limpa o valor. */
  inheritLabel?: string
  title?: string
  /** Id do rótulo visível (fora do gatilho), ligado por `aria-describedby`. */
  describedBy?: string
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [other, setOther] = useState(false)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)

  const label = pickerLabel(value, inheritLabel)
  const setModel = (model: string | null | undefined): void => {
    const next = { ...value }
    if (model === undefined) delete next.model
    else next.model = model
    onChange(next)
  }
  const setEffort = (effort: RuntimeChoice['effort'] | undefined): void => {
    const next = { ...value }
    if (effort === undefined) delete next.effort
    else next.effort = effort
    onChange(next)
  }
  const applyCustom = (): void => {
    const name = custom.trim().toLowerCase()
    if (!isModelName(name)) {
      setCustomError(MODEL_ERROR)
      return
    }
    setModel(name === 'default' ? null : name)
    setCustom('')
    setCustomError(null)
    setOther(false)
  }

  const showsInherit = !!inheritLabel && inheritLabel !== DEFAULT_LABEL
  const suggested = CLAUDE_MODELS.map((m) => ({ ...m, value: m.id === 'default' ? null : m.id }))
  const isCustomValue =
    typeof value.model === 'string' && !suggested.some((m) => m.value === value.model)

  const check = (on: boolean): React.JSX.Element => (
    <CheckIcon aria-hidden="true" className={cn('size-3.5', on ? 'opacity-100' : 'opacity-0')} />
  )

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setOther(false)
          setCustomError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label={`Modelo e raciocínio: ${label}`}
          title={title}
          aria-describedby={describedBy}
          className={cn('max-w-56 min-w-0 text-muted-foreground', className)}
        >
          <BrainIcon className="size-3.5" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandList aria-label="Modelo">
            <CommandGroup heading="Modelo">
              {showsInherit && (
                <CommandItem value="__inherit" onSelect={() => setModel(undefined)}>
                  <span className="flex-1 truncate">{inheritLabel}</span>
                  {check(value.model === undefined)}
                </CommandItem>
              )}
              {suggested.map((m) => (
                <CommandItem key={m.id} value={m.id} onSelect={() => setModel(m.value)}>
                  <span className="flex-1 truncate">{m.label}</span>
                  {check(
                    value.model === m.value ||
                      (m.value === null && value.model === undefined && !showsInherit)
                  )}
                </CommandItem>
              ))}
              {isCustomValue && (
                <CommandItem value="__custom-current" onSelect={() => undefined}>
                  <span className="flex-1 truncate font-mono text-xs">{value.model}</span>
                  {check(true)}
                </CommandItem>
              )}
              <CommandItem value="__other" onSelect={() => setOther(true)}>
                <span className="flex-1">Outro…</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        {other && (
          <div className="flex flex-col gap-2 border-t border-border-soft p-3">
            <TextField
              label="Nome do modelo"
              value={custom}
              mono
              size="sm"
              autoFocus
              placeholder="ex.: claude-opus-4-1"
              error={customError ?? undefined}
              onChange={(v) => {
                setCustom(v)
                setCustomError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyCustom()
                }
              }}
            />
            <Button size="xs" variant="secondary" className="self-end" onClick={applyCustom}>
              Usar
            </Button>
          </div>
        )}
        {supportsEffort && (
          <div className="flex flex-col gap-1.5 border-t border-border-soft p-3">
            <SegmentedControl
              label="Raciocínio"
              size="sm"
              className="grid w-full grid-cols-3"
              value={value.effort ?? ''}
              options={[
                { value: '', label: 'Padrão' },
                ...EFFORTS.map((e) => ({ value: e, label: EFFORT_LABELS[e] }))
              ]}
              onChange={(v) => {
                if (isEffort(v)) setEffort(v)
                else setEffort(inheritLabel ? undefined : null)
              }}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** O CLI instalado aceita `--effort`? (sem resposta = não mostra o raciocínio). */
export function useSupportsEffort(): boolean {
  return useClaudeStatus().status?.supportsEffort ?? false
}

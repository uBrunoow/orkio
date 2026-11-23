import * as React from 'react'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * Campos de formulário do Orkio sobre os componentes do shadcn/ui: rótulo, descrição e erro
 * ligados por id (aria-describedby / aria-invalid). Rótulo escondido continua sendo o nome
 * acessível (`sr-only`).
 */

type FieldBase = {
  label: string
  /** Esconde o rótulo visível (continua como nome acessível). */
  labelHidden?: boolean | undefined
  description?: React.ReactNode
  error?: string | null | undefined
  required?: boolean | undefined
  className?: string | undefined
}

export function Field({
  label,
  labelHidden,
  description,
  error,
  required,
  className,
  children
}: FieldBase & {
  children(ids: { id: string; describedBy: string | undefined; invalid: boolean }): React.ReactNode
}): React.JSX.Element {
  const id = React.useId()
  const descId = `${id}-desc`
  const errId = `${id}-err`
  const describedBy = [description ? descId : null, error ? errId : null].filter(Boolean).join(' ')
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id} className={cn(labelHidden && 'sr-only')}>
        {label}
        {required && <span className="text-muted-foreground"> (obrigatório)</span>}
      </Label>
      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {description && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  disabled,
  size = 'default',
  autoFocus,
  maxLength,
  onKeyDown,
  inputClassName,
  ...field
}: FieldBase & {
  value: string
  onChange(value: string): void
  placeholder?: string | undefined
  type?: 'text' | 'password' | 'search' | 'url' | 'number'
  mono?: boolean
  disabled?: boolean | undefined
  size?: 'default' | 'sm'
  autoFocus?: boolean
  maxLength?: number
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  inputClassName?: string
}): React.JSX.Element {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={maxLength}
          onKeyDown={onKeyDown}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={field.required}
          className={cn(mono && 'font-mono', size === 'sm' && 'h-7 text-xs', inputClassName)}
        />
      )}
    </Field>
  )
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 4,
  mono,
  disabled,
  onKeyDown,
  textareaClassName,
  ...field
}: FieldBase & {
  value: string
  onChange(value: string): void
  placeholder?: string | undefined
  rows?: number
  mono?: boolean
  disabled?: boolean | undefined
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  textareaClassName?: string
}): React.JSX.Element {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={onKeyDown}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(mono && 'font-mono text-xs', textareaClassName)}
        />
      )}
    </Field>
  )
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  size,
  hasSearch,
  searchPlaceholder,
  clearLabel,
  onClear,
  isLoading,
  selectClassName,
  ...field
}: FieldBase & {
  value?: string | null | undefined
  onChange(value: string): void
  options: readonly SelectOption[]
  placeholder?: string
  disabled?: boolean | undefined
  size?: 'default' | 'sm'
  hasSearch?: boolean
  searchPlaceholder?: string
  clearLabel?: string
  onClear?: () => void
  isLoading?: boolean
  selectClassName?: string
}): React.JSX.Element {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <Select
          id={id}
          aria-label={field.label}
          aria-describedby={describedBy}
          invalid={invalid}
          value={value}
          onChange={onChange}
          options={options}
          disabled={disabled}
          {...(placeholder ? { placeholder } : {})}
          {...(size ? { size } : {})}
          {...(hasSearch ? { hasSearch } : {})}
          {...(searchPlaceholder ? { searchPlaceholder } : {})}
          {...(clearLabel ? { clearLabel } : {})}
          {...(onClear ? { onClear } : {})}
          {...(isLoading ? { isLoading } : {})}
          {...(selectClassName ? { className: selectClassName } : {})}
        />
      )}
    </Field>
  )
}

/** Caixa de seleção com rótulo clicável e descrição opcional. */
export function CheckboxField({
  label,
  description,
  checked,
  onChange,
  disabled,
  className
}: {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean | undefined
  className?: string
}): React.JSX.Element {
  const id = React.useId()
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
        {...(description ? { 'aria-describedby': `${id}-desc` } : {})}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {description && (
          <p id={`${id}-desc`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

/** Interruptor com rótulo (papel `switch`). */
export function SwitchField({
  label,
  description,
  checked,
  onChange,
  disabled,
  className
}: {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean | undefined
  className?: string
}): React.JSX.Element {
  const id = React.useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

export interface RadioOption {
  value: string
  label: string
  description?: React.ReactNode
  disabled?: boolean
}

/** Lista de opções (papel `radiogroup`, cada uma `radio`). */
export function RadioListField({
  label,
  labelHidden,
  description,
  options,
  value,
  onChange,
  className
}: {
  label: string
  labelHidden?: boolean
  description?: React.ReactNode
  options: readonly RadioOption[]
  value: string | null | undefined
  onChange(value: string): void
  className?: string
}): React.JSX.Element {
  const id = React.useId()
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-2', className)}>
      <legend className={cn('mb-1.5 text-sm font-medium', labelHidden && 'sr-only')}>{label}</legend>
      {description && <p className="-mt-1 text-xs text-muted-foreground">{description}</p>}
      <RadioGroup value={value ?? ''} onValueChange={onChange} aria-label={label}>
        {options.map((o) => (
          <div key={o.value} className="flex items-start gap-2">
            <RadioGroupItem
              id={`${id}-${o.value}`}
              value={o.value}
              disabled={o.disabled}
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={`${id}-${o.value}`} className="font-normal">
                {o.label}
              </Label>
              {o.description && (
                <p className="text-xs text-muted-foreground">{o.description}</p>
              )}
            </div>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

export interface SegmentOption {
  value: string
  label: string
  icon?: React.ReactNode
  /** Esconde o texto (fica como nome acessível). */
  iconOnly?: boolean
}

/** Alternância de visualização (Kanban/Lista, Cards/Linhas): botões `radio` numa caixa só. */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  size = 'default',
  className
}: {
  label: string
  options: readonly SegmentOption[]
  value: string
  onChange(value: string): void
  size?: 'default' | 'sm'
  className?: string
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v)
      }}
      className={cn('rounded-md border border-border p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.label}
          className={cn(
            'h-auto min-w-0 rounded-sm border-0 px-2.5 text-muted-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground',
            size === 'sm' ? 'py-0.5 text-xs' : 'py-1 text-xs'
          )}
        >
          {o.icon}
          {!o.iconOnly && o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

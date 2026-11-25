import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { QuestionIcon } from './icons'

/**
 * Grupo de preferências em linhas (Configurações): título (h2), uma linha de explicação e uma
 * caixa só com as linhas separadas por divisórias. Cada linha é `SettingRow`: o nome à esquerda
 * (com o "?" da explicação mais longa) e o controle à direita. Use no lugar de um cartão por
 * opção quando a tela é uma lista de ajustes curtos (Aparência, Layout).
 */
export function SettingsGroup({
  title,
  description,
  bare,
  className,
  children
}: {
  title: string
  description?: React.ReactNode
  /** Sem a caixa das linhas (o conteúdo já tem a própria forma, ex.: cartões com figura). */
  bare?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-col gap-0.5 px-0.5">
        <h2 id={id} className="text-sm font-medium text-foreground">
          {title}
        </h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {bare ? (
        children
      ) : (
        <div className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
          {children}
        </div>
      )}
    </section>
  )
}

/** Linha de `SettingsGroup`. `stack` põe o controle embaixo (para controles largos, ex.: cartões). */
export function SettingRow({
  label,
  help,
  description,
  stack,
  labelFor,
  children
}: {
  label: string
  /** Explicação no "?" (tooltip), para não encher a linha. */
  help?: string
  /** Linha curta embaixo do nome, sempre visível. */
  description?: React.ReactNode
  stack?: boolean
  /** Id do controle, quando ele é um campo só (o nome vira o `<label>` dele). */
  labelFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  const Name = labelFor ? 'label' : 'span'
  return (
    <div
      className={cn(
        'flex min-h-13 gap-x-6 gap-y-3 px-4 py-3',
        stack ? 'flex-col' : 'flex-wrap items-center justify-between'
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <Name {...(labelFor ? { htmlFor: labelFor } : {})} className="text-sm text-foreground">
            {label}
          </Name>
          {help && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Sobre ${label.toLocaleLowerCase('pt-BR')}`}
                  className="flex size-4 items-center justify-center rounded-full text-subtle-foreground outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <QuestionIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72">
                {help}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/** Linha com um switch à direita (o nome da linha é o nome do switch). */
export function SwitchRow({
  label,
  help,
  description,
  checked,
  onChange,
  disabled
}: {
  label: string
  help?: string
  description?: React.ReactNode
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
}): React.JSX.Element {
  const id = useId()
  return (
    <SettingRow label={label} labelFor={id} {...(help ? { help } : {})} description={description}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </SettingRow>
  )
}

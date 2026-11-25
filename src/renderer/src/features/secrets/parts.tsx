/**
 * Peças das telas Segredos, Servidores MCP e Skills: a linha "Vale para", o campo do valor do
 * segredo (senha, sem autocompletar nem corretor) e a lista "Quem pode usar".
 */
import { Input } from '@/components/ui/input'
import { CheckboxField, Field } from '../../components/form'
import type { SecretUse } from '../../../../shared/vault'
import { hasUse, toggleUse } from './secrets-logic'

export function AppliesTo({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="-mt-2 text-xs text-muted-foreground" data-testid="applies-to">
      <span className="text-subtle-foreground">Vale para:</span> {children}
    </p>
  )
}

/** Valor do segredo: `type="password"`, sem autocompletar, corretor nem sugestões. */
export function SecretValueField({
  label,
  value,
  onChange,
  error,
  description,
  autoFocus
}: {
  label: string
  value: string
  onChange(value: string): void
  error?: string | null
  description?: React.ReactNode
  autoFocus?: boolean
}): React.JSX.Element {
  return (
    <Field label={label} error={error} description={description}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="font-mono"
        />
      )}
    </Field>
  )
}

/** "Quem pode usar": agentes e servidores MCP do Orkio, com checkbox. */
export function UsesPicker({
  uses,
  onChange,
  agents,
  servers,
  disabled
}: {
  uses: SecretUse[]
  onChange(uses: SecretUse[]): void
  agents: readonly { key: string; name: string }[]
  servers: readonly { id: string; name: string }[]
  disabled?: boolean
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">Quem pode usar</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
            Agentes
          </span>
          {agents.map((a) => {
            const use: SecretUse = { kind: 'agent', key: a.key }
            return (
              <CheckboxField
                key={a.key}
                label={a.name}
                checked={hasUse(uses, use)}
                disabled={disabled}
                onChange={(on) => onChange(toggleUse(uses, use, on))}
              />
            )
          })}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-2xs tracking-[0.06em] text-subtle-foreground uppercase">
            Servidores MCP
          </span>
          {servers.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum servidor no Orkio ainda.</p>
          )}
          {servers.map((s) => {
            const use: SecretUse = { kind: 'mcp', id: s.id }
            return (
              <CheckboxField
                key={s.id}
                label={s.name}
                checked={hasUse(uses, use)}
                disabled={disabled}
                onChange={(on) => onChange(toggleUse(uses, use, on))}
              />
            )
          })}
        </div>
      </div>
    </fieldset>
  )
}

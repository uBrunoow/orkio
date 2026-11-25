/**
 * Peças das telas Segredos, Servidores MCP e Skills: a linha "Vale para", o campo do valor do
 * segredo (senha, sem autocompletar nem corretor) e a lista "Quem pode usar".
 */
import { Input } from '@/components/ui/input'
import { Field } from '../../components/form'
import { McpPlugIcon } from '../../components/icons'
import type { AgentColor } from '../../../../shared/agent'
import { CheckCardGrid } from '../agents/AgentCheckGrid'
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

/** "Quem pode usar": agentes (com o rosto) e servidores MCP do Orkio, em cartões 2×2. */
export function UsesPicker({
  uses,
  onChange,
  agents,
  servers,
  disabled
}: {
  uses: SecretUse[]
  onChange(uses: SecretUse[]): void
  agents: readonly { key: string; name: string; color?: AgentColor; description?: string }[]
  servers: readonly { id: string; name: string; description?: string }[]
  disabled?: boolean
}): React.JSX.Element {
  const agentUse = (key: string): SecretUse => ({ kind: 'agent', key })
  const serverUse = (id: string): SecretUse => ({ kind: 'mcp', id })
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">Quem pode usar</legend>
      <div className="flex flex-col gap-2">
        <span className="label-caps">Agentes</span>
        <CheckCardGrid
          label="Agentes"
          disabled={disabled}
          items={agents.map((a) => ({
            key: a.key,
            name: a.name,
            description: a.description,
            face: { color: a.color, seed: a.key }
          }))}
          checked={(key) => hasUse(uses, agentUse(key))}
          onToggle={(key, on) => onChange(toggleUse(uses, agentUse(key), on))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="label-caps">Servidores MCP</span>
        {servers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum servidor no Orkio ainda.</p>
        ) : (
          <CheckCardGrid
            label="Servidores MCP"
            disabled={disabled}
            items={servers.map((s) => ({
              key: s.id,
              name: s.name,
              description: s.description,
              icon: <McpPlugIcon className="size-4" />
            }))}
            checked={(id) => hasUse(uses, serverUse(id))}
            onToggle={(id, on) => onChange(toggleUse(uses, serverUse(id), on))}
          />
        )}
      </div>
    </fieldset>
  )
}

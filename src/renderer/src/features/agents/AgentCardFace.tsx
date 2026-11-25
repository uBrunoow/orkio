import {
  AGENT_ROLE_LABELS,
  agentGroupLabel,
  type AgentProfile,
  type AgentScope
} from '../../../../shared/agent'
import { AGENTS_DIR } from '../../../../shared/orkio-scratch'
import { StatusToken } from '../../components/StatusToken'
import { AgentAvatar } from './AgentAvatar'

export const SCOPE_TAG: Record<AgentScope, string> = {
  builtin: 'Embutido',
  repo: AGENTS_DIR,
  local: 'Este computador'
}

/** "Revisor(a) · Embutido": o catálogo do Orkio se distingue dos perfis do time. */
export function agentRoleLine(profile: AgentProfile, scope: AgentScope): string {
  const role = AGENT_ROLE_LABELS[profile.role]
  return scope === 'builtin' ? `${role} · Embutido` : role
}

/** Segunda linha do card (Fase 3): "O que faz", ou o papel quando não há descrição. */
export function agentSubtitle(profile: AgentProfile, scope: AgentScope): string {
  return profile.description?.trim() || agentRoleLine(profile, scope)
}

/** Cabeçalho do card (lista e prévia do editor): avatar, nome, o que faz e o grupo. */
export function AgentCardHead({
  name,
  profile,
  scope,
  seed,
  children
}: {
  name: string
  profile: AgentProfile | null
  scope: AgentScope
  seed: string
  /** Fallback da segunda linha sem perfil (o arquivo). */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <AgentAvatar name={name} color={profile?.color ?? 'yellow'} seed={seed} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <p className="truncate font-medium">{name}</p>
        <p
          className="line-clamp-2 text-xs text-muted-foreground"
          data-testid="agent-description"
          title={profile?.description || undefined}
        >
          {profile ? agentSubtitle(profile, scope) : children}
        </p>
        {profile?.group && (
          <p className="truncate text-2xs text-subtle-foreground" data-testid="agent-group">
            {agentGroupLabel(profile.group)}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Prévia ao vivo do card ("Como vai aparecer"): as mesmas peças do card da lista, sem ações nem
 * números do dia (o agente ainda não rodou).
 */
export function AgentCardPreview({
  profile,
  scope
}: {
  profile: AgentProfile
  scope: AgentScope
}): React.JSX.Element {
  const name = profile.name.trim() || 'Sem nome'
  return (
    <div
      data-testid="agent-card-preview"
      aria-label={`Prévia do card: ${name}`}
      role="group"
      className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-3.5"
    >
      <AgentCardHead
        name={name}
        profile={{ ...profile, name }}
        scope={scope}
        seed={profile.id || name}
      />
      <StatusToken tone="neutral" label="Livre" className="text-sm" />
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-2.5">
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground">
          {SCOPE_TAG[scope]}
        </span>
        {profile.command && (
          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground">
            /{profile.command}
          </span>
        )}
      </div>
    </div>
  )
}

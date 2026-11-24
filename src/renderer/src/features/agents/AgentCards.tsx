import {
  buildAgentPrompt,
  AGENT_ROLE_LABELS,
  type AgentsState,
  type AgentView
} from '../../../../shared/agent'
import type { OrchestratorAgentLoad } from '../../../../shared/orchestrator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { Spinner } from '../../components/Spinner'
import { StatusToken } from '../../components/StatusToken'
import { CopyIcon, EditIcon, MoreIcon } from '../../components/icons'
import { formatUsd } from '../../lib/format'
import { AGENT_STATUS } from '../../lib/status-text'
import { AgentAvatar } from './AgentAvatar'
import { ProfileSummary, ReadOnlyText } from './AgentEditor'
import type { AgentNow } from './agent-state'
import { Sparkline } from './Sparkline'

const SCOPE_TAG: Record<AgentView['scope'], string> = {
  builtin: 'Embutido',
  repo: '.orkio/agents',
  local: 'Este computador'
}

/** Perfil que não roda até alguém agir (revisar ou corrigir): o "agora" do card já diz isso. */
function profileBlocked(view: AgentView): boolean {
  return view.status === 'needs_review' || view.status === 'invalid'
}

/** "Revisor(a) · Embutido": o catálogo do Orkio se distingue dos perfis do time. */
function roleLine(view: AgentView): string {
  if (!view.profile) return view.file
  const role = AGENT_ROLE_LABELS[view.profile.role]
  return view.scope === 'builtin' ? `${role} · Embutido` : role
}

export interface AgentHandlers {
  isReviewing: boolean
  busy: boolean
  now: AgentNow
  load: OrchestratorAgentLoad | null
  onEdit(): void
  onDuplicate(): void
  onArchive(): void
  onReview(): void
  onApprove(): void
}

function Tag({ hot = false, children }: { hot?: boolean; children: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 font-mono text-2xs',
        hot
          ? 'border-brand-tint-border bg-brand-tint text-brand-tint-foreground'
          : 'border-border text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

function AgentDetails({
  view,
  state,
  isReviewing,
  busy,
  onReview,
  onApprove,
  compact = false
}: {
  view: AgentView
  state: AgentsState
  compact?: boolean
} & AgentHandlers): React.JSX.Element | null {
  const p = view.profile
  const name = p?.name ?? view.id
  const flowName = p?.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : null
  const details = [
    view.assigned === 1 ? '1 tarefa' : `${view.assigned} tarefas`,
    view.usageToday.runs === 1 ? '1 execução hoje' : `${view.usageToday.runs} execuções hoje`,
    flowName ? `fluxo ${flowName}` : null
  ].filter(Boolean)
  const needsReview = view.status === 'needs_review' && p
  if (
    compact &&
    view.errors.length === 0 &&
    view.warnings.length === 0 &&
    !needsReview &&
    !(isReviewing && p)
  ) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      {!compact && <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>}
      {view.errors.map((e) => (
        <Alert key={e} tone="danger">
          {e}
        </Alert>
      ))}
      {view.warnings.map((w) => (
        <p key={w} className="text-xs text-warn">
          {w}
        </p>
      ))}
      {needsReview && (
        <Alert
          tone="warning"
          {...(!isReviewing
            ? {
                action: (
                  <Button size="xs" variant="outline" onClick={onReview}>
                    {`Revisar ${name}`}
                  </Button>
                )
              }
            : {})}
        >
          O perfil de {name} mudou no repositório desde a última aprovação. Revise antes de ele
          rodar de novo.
        </Alert>
      )}
      {isReviewing && p && (
        <div className="flex flex-col gap-3">
          <ProfileSummary profile={p} state={state} />
          <ReadOnlyText
            label="O que vai no início da conversa"
            value={buildAgentPrompt(p)}
            rows={8}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={onApprove}>
              {busy && <Spinner />}
              Aprovar este perfil
            </Button>
            <Button size="sm" variant="ghost" onClick={onReview}>
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentActions({
  view,
  onEdit,
  onDuplicate,
  onArchive
}: { view: AgentView } & AgentHandlers): React.JSX.Element | null {
  const p = view.profile
  if (!p) return null
  const name = p.name
  if (view.scope === 'builtin') {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Duplicar ${name}`}
        title="Duplicar"
        onClick={onDuplicate}
      >
        <CopyIcon />
      </Button>
    )
  }
  return (
    <div className="flex shrink-0 items-center">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Editar ${name}`}
        title="Editar"
        onClick={onEdit}
      >
        <EditIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Ações de ${name}`}>
            <MoreIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDuplicate}>{`Duplicar ${name}`}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            {p.archived ? `Desarquivar ${name}` : `Arquivar ${name}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function AgentRow(
  props: { view: AgentView; state: AgentsState } & AgentHandlers
): React.JSX.Element {
  const { view, now } = props
  const p = view.profile
  const name = p?.name ?? view.id
  const status = AGENT_STATUS[view.status]
  return (
    <li
      aria-label={name}
      className="flex items-start gap-3 border-b border-border-soft px-4 py-3 last:border-b-0"
    >
      <AgentAvatar name={name} color={p?.color ?? 'yellow'} seed={view.key} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium">{name}</span>
          {p && <span className="text-xs text-muted-foreground">{roleLine(view)}</span>}
        </div>
        <StatusToken tone={now.tone} label={now.text} data-testid="agent-now" />
        <AgentDetails {...props} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Sparkline
          values={view.activity}
          label={`${view.activity.reduce((x, y) => x + y, 0)} execuções nas últimas 12 horas`}
        />
        {/* Perfil a revisar/inválido já aparece no "agora" (mesmo texto). */}
        {!profileBlocked(view) && <StatusToken {...status} />}
        <AgentActions {...props} />
      </div>
    </li>
  )
}

export function AgentCard(
  props: { view: AgentView; state: AgentsState } & AgentHandlers
): React.JSX.Element {
  const { view, now, load } = props
  const p = view.profile
  const name = p?.name ?? view.id
  const status = AGENT_STATUS[view.status]
  const capacity = load
    ? `${load.active}/${load.capacity} ${load.capacity === 1 ? 'vaga' : 'vagas'}`
    : null
  const cost = view.usageToday.costUsd > 0 ? `${formatUsd(view.usageToday.costUsd)} hoje` : null
  return (
    <div
      role="listitem"
      aria-label={name}
      data-testid="agent-card"
      className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-3.5"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar name={name} color={p?.color ?? 'yellow'} seed={view.key} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {p ? (p.instructions.split('\n').find((l) => l.trim()) ?? roleLine(view)) : view.file}
          </p>
        </div>
        <AgentActions {...props} />
      </div>
      <div className="flex items-center gap-2">
        <StatusToken
          tone={now.tone}
          label={now.text}
          data-testid="agent-now"
          className="min-w-0 flex-1 text-sm"
        />
        <Sparkline
          values={view.activity}
          label={`${view.activity.reduce((x, y) => x + y, 0)} execuções nas últimas 12 horas`}
        />
      </div>
      <AgentDetails {...props} compact />
      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-2.5">
        {now.tasks.slice(0, 3).map((t) => (
          <Tag key={t.taskId} hot={t.hot}>
            {t.displayId ?? 'tarefa'}
          </Tag>
        ))}
        {now.tasks.length === 0 && <Tag>{SCOPE_TAG[view.scope]}</Tag>}
        {view.status === 'archived' && <StatusToken {...status} className="ml-1" />}
        {(capacity || cost) && (
          <span className="tabular ml-auto text-2xs text-subtle-foreground">
            {[capacity, cost].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}

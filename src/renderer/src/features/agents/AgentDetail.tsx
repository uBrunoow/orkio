import {
  AGENT_AUTONOMY_TEXT,
  AGENT_MODEL_LABELS,
  AGENT_ROLE_LABELS,
  agentAutonomy,
  agentGroupLabel,
  type AgentProfile,
  type AgentsState,
  type AgentView
} from '../../../../shared/agent'
import { EFFORT_LABELS } from '../../../../shared/agent-runtime'
import type { OrchestratorAgentLoad } from '../../../../shared/orchestrator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { StatusToken } from '../../components/StatusToken'
import {
  BackIcon,
  BrainIcon,
  ChevronRightIcon,
  CopyIcon,
  EditIcon,
  GaugeIcon,
  InstructionsIcon,
  LockIcon,
  ModelIcon,
  MoreIcon,
  PermissionIcon,
  ToolIcon,
  type SvgIcon
} from '../../components/icons'
import { formatUsd, plural } from '../../lib/format'
import { unwrap, useIpcResource } from '../../lib/ipc'
import { RuntimePicker, useSupportsEffort } from '../claude/RuntimePicker'
import { AgentAvatar } from './AgentAvatar'
import { SCOPE_TAG } from './AgentCardFace'
import type { AgentNow } from './agent-state'

/** Parte da configuração que a linha abre no editor (ou na Memória). */
export type AgentSetupPart =
  'instructions' | 'model' | 'memory' | 'tools' | 'permissions' | 'limits'

/**
 * Página do agente (aberta pelo card): quem é, como tem ido e a configuração em linhas, no lugar
 * da lista. Cada linha resume uma parte do perfil e abre o editor nela; o modelo troca aqui mesmo.
 * Embutido é só leitura (cadeado): "Duplicar" cria uma cópia editável.
 */
export function AgentDetail({
  projectId,
  view,
  state,
  now,
  load,
  busy,
  onBack,
  onEdit,
  onDuplicate,
  onArchive,
  onMemory,
  onSaveProfile
}: {
  projectId: string
  view: AgentView
  state: AgentsState
  now: AgentNow
  load: OrchestratorAgentLoad | null
  busy: boolean
  onBack(): void
  onEdit(part: AgentSetupPart): void
  onDuplicate(): void
  onArchive(): void
  onMemory(): void
  /** Troca rápida (modelo e raciocínio): salva o perfil inteiro com a mudança. */
  onSaveProfile(profile: AgentProfile): void
}): React.JSX.Element {
  const p = view.profile
  const name = p?.name ?? view.id
  const readOnly = view.scope === 'builtin' || !p
  const memory = useIpcResource(`${projectId}\u0000${view.key}`, (k) => {
    const [proj, key] = k.split('\u0000') as [string, string]
    return window.orkio.agents.memory(proj, key).then(unwrap)
  })

  return (
    <div role="region" aria-label={`Agente ${name}`} className="flex flex-col gap-6">
      <AgentCrumbs name={name} onBack={onBack}>
        {p && view.scope !== 'builtin' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Ações de ${name}`}>
                <MoreIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onDuplicate}>{`Duplicar ${name}`}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onArchive}>
                {p.archived ? `Desarquivar ${name}` : `Arquivar ${name}`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </AgentCrumbs>

      <header className="flex flex-wrap items-start gap-5">
        <AgentAvatar name={name} color={p?.color ?? 'yellow'} seed={view.key} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-medium text-foreground">{name}</h2>
            {p && <Chip>{AGENT_ROLE_LABELS[p.role]}</Chip>}
            <Chip mono>{SCOPE_TAG[view.scope]}</Chip>
            {p?.group && <Chip>{agentGroupLabel(p.group)}</Chip>}
          </div>
          {p?.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
          <StatusToken tone={now.tone} label={now.text} data-testid="agent-now" />
        </div>
        {p &&
          (readOnly ? (
            <Button variant="outline" onClick={onDuplicate}>
              <CopyIcon />
              {`Duplicar ${name}`}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onEdit('instructions')}>
              <EditIcon />
              {`Editar ${name}`}
            </Button>
          ))}
      </header>

      {view.errors.map((e) => (
        <Alert key={e} tone="danger">
          {e}
        </Alert>
      ))}
      {view.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <HowItsGoing view={view} now={now} load={load} />
        <section aria-labelledby="agent-setup" className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5 px-0.5">
            <h3 id="agent-setup" className="text-sm font-medium text-foreground">
              Configuração
            </h3>
            <p className="text-xs text-muted-foreground">
              {view.scope === 'builtin'
                ? 'Embutido no Orkio: duplique para mudar.'
                : `Em ${view.file}`}
            </p>
          </div>
          {p ? (
            <div className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
              <SetupRow
                icon={InstructionsIcon}
                title="Instruções"
                summary={
                  firstLine(p.instructions) || 'Sem instruções: segue só o briefing da tarefa.'
                }
                locked={readOnly}
                onOpen={() => onEdit('instructions')}
              />
              <ModelRow
                profile={p}
                readOnly={readOnly}
                busy={busy}
                onChange={(patch) => onSaveProfile({ ...p, ...patch })}
              />
              <SetupRow
                icon={BrainIcon}
                title="Memória"
                summary={
                  memory.value
                    ? memory.value.notes.length === 0
                      ? 'Nada ainda'
                      : `${plural(memory.value.notes.length, 'nota', 'notas')} · ${Math.round((memory.value.used / Math.max(1, memory.value.budget)) * 100)}% cheia`
                    : 'Carregando…'
                }
                onOpen={onMemory}
              />
              <SetupRow
                icon={ToolIcon}
                title="Ferramentas"
                summary={toolsSummary(p, state)}
                locked={readOnly}
                onOpen={() => onEdit('tools')}
              />
              <SetupRow
                icon={PermissionIcon}
                title="Permissões"
                summary={`${AGENT_AUTONOMY_TEXT[agentAutonomy(p)].label} · ${p.delivery ? 'pode entregar (push e PR, com os gates)' : 'não entrega'}`}
                locked={readOnly}
                onOpen={() => onEdit('permissions')}
              />
              <SetupRow
                icon={GaugeIcon}
                title="Limites"
                summary={`${p.limits.parallel} em paralelo · ${plural(p.limits.stepsPerDay, 'execução', 'execuções')}/dia${p.limits.costPerDayUsd !== null ? ` · ${formatUsd(p.limits.costPerDayUsd)}/dia` : ''}`}
                locked={readOnly}
                onOpen={() => onEdit('limits')}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              O arquivo do perfil não pôde ser lido. Corrija {view.file} para ver a configuração.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

export function Chip({ mono, children }: { mono?: boolean; children: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground',
        mono && 'font-mono'
      )}
    >
      {children}
    </span>
  )
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
      .find(Boolean) ?? ''
  )
}

function toolsSummary(p: AgentProfile, state: AgentsState): string {
  const commands =
    p.commands.length === 0
      ? 'Todos os comandos e skills'
      : p.commands.map((c) => `/${c}`).join(', ')
  const flow = p.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : null
  return [commands, p.command ? `prefere /${p.command}` : null, flow ? `fluxo ${flow}` : null]
    .filter(Boolean)
    .join(' · ')
}

/** Linha da configuração: ícone, título, resumo e o que acontece ao clicar (cadeado = só leitura). */
export function SetupRow({
  icon: Icon,
  title,
  summary,
  locked,
  onOpen,
  children
}: {
  icon: SvgIcon
  title: string
  summary: string
  locked?: boolean
  onOpen?: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-sm text-foreground">{title}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{summary}</span>
      </span>
    </>
  )
  if (locked) {
    return (
      <div className="flex items-start gap-3 px-4 py-3">
        {body}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={`${title}: só leitura`}
              className="mt-0.5 rounded-sm text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <LockIcon className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">Embutido no Orkio: duplique para mudar.</TooltipContent>
        </Tooltip>
        {children}
      </div>
    )
  }
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${title}: ${summary}`}
        className="flex items-start gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
      >
        {body}
        <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
      </button>
      {children}
    </div>
  )
}

/** Modelo e raciocínio: troca aqui mesmo (agente editável); embutido mostra com cadeado. */
function ModelRow({
  profile: p,
  readOnly,
  busy,
  onChange
}: {
  profile: AgentProfile
  readOnly: boolean
  busy: boolean
  onChange(patch: Pick<AgentProfile, 'model' | 'effort'>): void
}): React.JSX.Element {
  const supportsEffort = useSupportsEffort()
  const model = AGENT_MODEL_LABELS[p.model] ?? p.model
  const summary =
    p.model === 'default'
      ? 'Usa o padrão do Claude Code'
      : p.effort
        ? `${model} · raciocínio ${EFFORT_LABELS[p.effort].toLowerCase()}`
        : model
  if (readOnly) return <SetupRow icon={ModelIcon} title="Modelo" summary={summary} locked />
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex items-start gap-3">
        <ModelIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-foreground">Modelo</span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </div>
      </div>
      <div className="pl-7">
        <RuntimePicker
          variant="pill"
          value={{ model: p.model === 'default' ? null : p.model, effort: p.effort }}
          supportsEffort={supportsEffort}
          onChange={(next) => {
            if (busy) return
            const model = next.model ?? 'default'
            const effort = next.effort ?? null
            if (model !== p.model || effort !== p.effort) onChange({ model, effort })
          }}
        />
      </div>
    </div>
  )
}

/** "Como tem ido": números do dia, atividade das últimas horas e as tarefas de agora. */
function HowItsGoing({
  view,
  now,
  load
}: {
  view: AgentView
  now: AgentNow
  load: OrchestratorAgentLoad | null
}): React.JSX.Element {
  const p = view.profile
  const total = view.activity.reduce((a, b) => a + b, 0)
  const peak = Math.max(1, ...view.activity)
  const quiet = total === 0 && view.usageToday.runs === 0 && view.assigned === 0
  const name = p?.name ?? view.id
  return (
    <section aria-labelledby="agent-going" className="flex flex-col gap-2.5">
      <h3 id="agent-going" className="px-0.5 text-sm font-medium text-foreground">
        Como tem ido
      </h3>
      <div className="flex flex-col gap-5 rounded-xl border border-border-soft bg-card p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Tarefas com ele" value={String(view.assigned)} />
          <Stat
            label="Execuções hoje"
            value={String(view.usageToday.runs)}
            {...(p ? { of: `de ${p.limits.stepsPerDay}` } : {})}
          />
          <Stat
            label="Custo hoje"
            value={formatUsd(view.usageToday.costUsd)}
            {...(p?.limits.costPerDayUsd != null
              ? { of: `de ${formatUsd(p.limits.costPerDayUsd)}` }
              : {})}
          />
          <Stat
            label="Vagas"
            value={load ? `${load.active}/${load.capacity}` : `0/${p?.limits.parallel ?? 1}`}
          />
        </dl>
        {load?.limitProblem && <Alert tone="warning">{load.limitProblem}</Alert>}

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? 'Nenhuma execução nas últimas 12 horas.'
              : `${plural(total, 'execução', 'execuções')} nas últimas 12 horas`}
          </p>
          <div
            role="img"
            aria-label={`Execuções por hora nas últimas 12 horas: ${view.activity.join(', ')}`}
            className="flex h-16 items-end gap-1"
          >
            {view.activity.map((n, i) => (
              <span
                key={i}
                className={cn(
                  'min-h-0.5 flex-1 rounded-sm',
                  n > 0 ? 'bg-muted-foreground/60' : 'bg-border-soft'
                )}
                style={{ height: `${Math.max(4, (n / peak) * 100)}%` }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
          <p className="text-xs text-muted-foreground">Agora</p>
          {now.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {quiet
                ? `${name} ainda não pegou nenhuma tarefa neste projeto. Atribua uma no quadro ou ligue o orquestrador.`
                : `${name} está livre.`}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {now.tasks.map((t) => (
                <li
                  key={t.taskId}
                  className={cn(
                    'rounded-full border px-2 py-0.5 font-mono text-2xs',
                    t.hot
                      ? 'border-brand-tint-border bg-brand-tint text-brand-tint-foreground'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {t.displayId ?? 'tarefa'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export function Stat({
  label,
  value,
  of
}: {
  label: string
  value: string
  of?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span className="tabular text-lg text-foreground">{value}</span>
        {of && <span className="tabular text-xs text-subtle-foreground">{of}</span>}
      </dd>
    </div>
  )
}

/** "← Agentes / Nome" no topo da página de um agente (e do orquestrador). */
export function AgentCrumbs({
  name,
  onBack,
  children
}: {
  name: string
  onBack(): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <nav aria-label="Caminho" className="flex items-center gap-1.5 text-sm">
      <Button size="icon-sm" variant="ghost" aria-label="Voltar para Agentes" onClick={onBack}>
        <BackIcon />
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        Agentes
      </button>
      <span aria-hidden="true" className="text-subtle-foreground">
        /
      </span>
      <span className="text-foreground">{name}</span>
      {children}
    </nav>
  )
}

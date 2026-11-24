import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AGENT_COLORS,
  AGENT_LIMITS,
  AGENT_MODEL_LABELS,
  AGENT_ROLE_LABELS,
  AGENT_ROLES,
  agentIdFromName,
  buildAgentPrompt,
  defaultAgent,
  validateAgent,
  type AgentColor,
  type AgentProfile,
  type AgentScope,
  type AgentsState,
  type AgentView
} from '../../../../shared/agent'
import type { OrchestratorAgentLoad, OrchestratorState } from '../../../../shared/orchestrator'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  CheckboxField,
  Field,
  RadioListField,
  SelectField,
  TextAreaField,
  TextField
} from '@/components/form'
import { cn } from '@/lib/utils'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { isTextField } from '../../app/shortcuts'
import { Alert } from '../../components/Alert'
import { EmptyState } from '../../components/PageState'
import { ScreenTitle } from '../../components/ScreenTitle'
import { Spinner } from '../../components/Spinner'
import { StatusToken, toneOf } from '../../components/StatusToken'
import {
  CopyIcon,
  EditIcon,
  GridIcon,
  ListIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon
} from '../../components/icons'
import { formatUsd } from '../../lib/format'
import { useOverview } from '../overview/useOverview'
import { AgentAvatar } from './AgentAvatar'
import { useAgentBadges } from './agent-badges'
import { agentNow, type AgentFilter, type AgentNow } from './agent-state'
import { MultiSelectField } from './MultiSelectField'
import { Sparkline } from './Sparkline'
import { RuntimePicker, useSupportsEffort } from '../claude/RuntimePicker'
import type { ProjectView } from '../../../../shared/projects'

const COLOR_LABELS: Record<AgentColor, string> = {
  orange: 'Laranja',
  blue: 'Azul',
  green: 'Verde',
  purple: 'Roxo',
  pink: 'Rosa',
  teal: 'Verde-azulado',
  yellow: 'Amarelo'
}

const STATUS_TOKEN: Record<
  AgentView['status'],
  { label: string; color: 'green' | 'yellow' | 'red' | 'gray' }
> = {
  ready: { label: 'Pronto', color: 'green' },
  needs_review: { label: 'Revisar perfil', color: 'yellow' },
  invalid: { label: 'Com erro', color: 'red' },
  archived: { label: 'Arquivado', color: 'gray' }
}

type Editing = { mode: 'new' | 'edit'; scope: AgentScope; draft: AgentProfile; key: string | null }

/** Tela "Agentes" (8A): perfis, aprovação dos perfis do repositório e regras por coluna. */
export function AgentsPage({
  projectId: currentProjectId = null,
  onOpenOrchestrator
}: {
  /** Projeto atual (as tarefas e a carga dos agentes são deste projeto). */
  projectId?: string | null
  /** "Orquestrador: ligado/desligado" leva a Configurações › Agentes do projeto. */
  onOpenOrchestrator?: () => void
} = {}): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [state, setState] = useState<AgentsState | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [commands, setCommands] = useState<string[]>([])
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [layout, setLayout] = useState<'cards' | 'rows'>('cards')
  const searchInput = useRef<HTMLInputElement | null>(null)

  // "/" foca a busca (fora de campos de texto), como nas listas das referências.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return
      const input = searchInput.current
      if (!input) return
      e.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    let active = true
    void window.orkio.projects
      .list()
      .then((r) => {
        if (!active) return
        setProjects(r.projects)
        setProjectId(
          (cur) =>
            cur ??
            (currentProjectId && r.projects.some((p) => p.id === currentProjectId)
              ? currentProjectId
              : (r.projects[0]?.id ?? null))
        )
      })
      .catch(() => {
        if (active) setProjects([])
      })
    return () => {
      active = false
    }
  }, [currentProjectId])

  useEffect(() => {
    if (!projectId) return
    let alive = true
    const load = (): void => {
      void window.orkio.agents.list(projectId).then((r) => {
        if (!alive) return
        if (r.ok) setState(r.value)
        else setMessage({ tone: 'error', text: r.error.message })
      })
    }
    load()
    void window.orkio.claude.catalog(projectId, 'agentes').then((r) => {
      if (alive && r.ok) {
        setCommands([...new Set(r.value.flatMap((g) => g.commands.map((c) => c.name)))])
      }
    })
    const off = window.orkio.agents.onChanged((e) => {
      if (e.projectId === projectId) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId])

  const badges = useAgentBadges(projectId ?? '')
  const { snapshot } = useOverview()
  const orchestrator = useOrchestrator(projectId)

  if (projects === null) return <Skeleton className="h-60" aria-label="Carregando agentes" />

  const active = (state?.agents ?? []).filter((a) => a.status !== 'archived').length
  const header = (
    <>
      <ScreenBarStart>
        <div className="flex items-center gap-2">
          <ScreenTitle look={5}>Agentes</ScreenTitle>
          {state && <span className="tabular text-sm text-subtle-foreground">{active}</span>}
        </div>
      </ScreenBarStart>
      <ScreenBarEnd>
        <div className="flex items-center gap-2">
          {projects.length > 1 && (
            <Select
              aria-label="Projeto"
              size="sm"
              className="w-[200px]"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              value={projectId}
              onChange={(value) => {
                setState(null)
                setEditing(null)
                setProjectId(value)
              }}
            />
          )}
          {projectId && onOpenOrchestrator && (
            <Button variant="outline" onClick={onOpenOrchestrator}>
              {`Orquestrador: ${orchestrator?.config.enabled ? 'ligado' : 'desligado'}`}
            </Button>
          )}
          {projectId && (
            <Button
              onClick={() => {
                setMessage(null)
                setEditing({ mode: 'new', scope: 'repo', draft: defaultAgent(), key: null })
              }}
            >
              <PlusIcon />
              Novo agente
            </Button>
          )}
        </div>
      </ScreenBarEnd>
    </>
  )

  if (!projectId) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <EmptyState
          title="Nenhum projeto ainda"
          description="Adicione um projeto em Projetos para criar agentes para ele."
        />
      </div>
    )
  }

  const save = async (e: Editing): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const r = await window.orkio.agents.save({
      projectId,
      scope: e.scope,
      profile: e.draft,
      isNew: e.mode === 'new'
    })
    setBusy(false)
    if (!r.ok) {
      setMessage({ tone: 'error', text: r.error.message })
      return
    }
    setState(r.value)
    setEditing(null)
    setMessage({
      tone: 'ok',
      text:
        e.scope === 'repo'
          ? `Perfil salvo em .orkio/agents/${e.draft.id}.md. Commite o arquivo para o time usar o mesmo agente.`
          : 'Perfil salvo neste computador.'
    })
  }

  const approve = async (view: AgentView): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.agents.approve(projectId, view.key, view.hash)
    setBusy(false)
    if (r.ok) {
      setState(r.value)
      setReviewing(null)
      setMessage({ tone: 'ok', text: `Perfil de ${view.profile?.name ?? view.id} aprovado.` })
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  const q = query.trim().toLowerCase()
  const nowOf = (a: AgentView): AgentNow => agentNow({ agent: a, badges, snapshot, projectId })
  const allNow = new Map((state?.agents ?? []).map((a) => [a.key, nowOf(a)]))
  const visibleAgents = (state?.agents ?? [])
    .filter(
      (a) =>
        matchesFilter(a, allNow.get(a.key)!, filter) &&
        (!q ||
          (a.profile?.name ?? a.id).toLowerCase().includes(q) ||
          (a.profile ? AGENT_ROLE_LABELS[a.profile.role].toLowerCase().includes(q) : false))
    )
    .sort((a, b) => ORDER[allNow.get(a.key)!.filter] - ORDER[allNow.get(b.key)!.filter])
  const countOf = (f: Filter): number =>
    (state?.agents ?? []).filter((a) => matchesFilter(a, allNow.get(a.key)!, f)).length
  const handlersFor = (a: AgentView): AgentHandlers => ({
    isReviewing: reviewing === a.key,
    busy,
    now: allNow.get(a.key)!,
    load: orchestrator?.agents.find((l) => l.key === a.key) ?? null,
    onEdit: () => {
      if (!a.profile) return
      setMessage(null)
      setEditing({ mode: 'edit', scope: a.scope, draft: a.profile, key: a.key })
    },
    onDuplicate: () => {
      if (!a.profile) return
      setMessage(null)
      setEditing({
        mode: 'new',
        // Embutido não é gravável: a cópia vai para o repositório (dá para trocar no editor).
        scope: a.scope === 'builtin' ? 'repo' : a.scope,
        draft: {
          ...a.profile,
          id: '',
          name: a.scope === 'builtin' ? `${a.profile.name} do time` : `${a.profile.name} (cópia)`,
          archived: false
        },
        key: null
      })
    },
    onArchive: () => {
      if (!a.profile) return
      void save({
        mode: 'edit',
        scope: a.scope,
        draft: { ...a.profile, archived: !a.profile.archived },
        key: a.key
      })
    },
    onReview: () => setReviewing(reviewing === a.key ? null : a.key),
    onApprove: () => void approve(a)
  })
  const hasAgents = state !== null && state.agents.length > 0

  return (
    // A tela vem num contêiner com margem (App): a barra de filtros ocupa a largura toda.
    <div role="region" aria-label="Agentes" className="-mx-6 -mt-5 flex flex-col">
      {header}
      {hasAgents && (
        <div
          role="toolbar"
          aria-label="Filtros de agentes"
          className="flex flex-wrap items-center gap-2 border-b border-border-soft px-[18px] py-3"
        >
          <div className="relative w-60">
            <Input
              ref={searchInput}
              type="search"
              aria-label="Buscar agentes"
              placeholder="Buscar agentes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-transparent pr-8"
            />
            {!query && <Kbd className="absolute top-1/2 right-2 -translate-y-1/2 border-0">/</Kbd>}
          </div>
          <div className="flex-1" />
          <ToggleGroup
            type="single"
            spacing={0.5}
            aria-label="Filtrar por estado"
            value={filter}
            onValueChange={(v) => {
              const next = FILTERS.find((f) => f.value === v)
              if (next) setFilter(next.value)
            }}
          >
            {FILTERS.filter(
              (f) => f.value !== 'archived' || filter === 'archived' || countOf(f.value) > 0
            ).map((f) => (
              <ToggleGroupItem key={f.value} value={f.value} className={PILL}>
                {f.label}
                {f.value !== 'all' && (
                  <span className="tabular font-normal text-subtle-foreground">
                    {countOf(f.value)}
                  </span>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            spacing={0.5}
            aria-label="Visualização dos agentes"
            value={layout}
            onValueChange={(v) => {
              if (v) setLayout(v === 'rows' ? 'rows' : 'cards')
            }}
            className="ml-3"
          >
            <ToggleGroupItem value="rows" className={PILL}>
              <ListIcon className="size-3.5" />
              Linhas
            </ToggleGroupItem>
            <ToggleGroupItem value="cards" className={PILL}>
              <GridIcon className="size-3.5" />
              Cards
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <div className="flex flex-col gap-4 px-[18px] py-4">
        {message &&
          (message.tone === 'error' ? (
            <Alert tone="danger">{message.text}</Alert>
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {message.text}
            </p>
          ))}

        {editing && (
          <AgentEditor
            editing={editing}
            state={state}
            commands={commands}
            busy={busy}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={(e) => void save(e)}
          />
        )}

        {state === null ? (
          <Skeleton className="h-30" aria-label="Carregando agentes" />
        ) : state.agents.length === 0 ? (
          !editing && (
            <EmptyState
              title="Nenhum agente ainda"
              description="Crie um agente (ex.: Ana, implementadora) e atribua tarefas a ele no quadro."
            />
          )
        ) : visibleAgents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum agente com esse filtro.</p>
        ) : layout === 'rows' ? (
          <ul
            aria-label="Lista de agentes"
            className="overflow-hidden rounded-xl border border-border-soft bg-card"
          >
            {visibleAgents.map((a) => (
              <AgentRow key={a.key} view={a} state={state} {...handlersFor(a)} />
            ))}
          </ul>
        ) : (
          <div role="list" aria-label="Lista de agentes" className="flex flex-col gap-5">
            {[
              {
                title: 'Trabalhando agora',
                agents: visibleAgents.filter((a) => allNow.get(a.key)!.filter !== 'stopped')
              },
              {
                title: filter === 'archived' ? 'Arquivados' : 'Disponíveis',
                agents: visibleAgents.filter((a) => allNow.get(a.key)!.filter === 'stopped')
              }
            ]
              .filter((g) => g.agents.length > 0)
              .map((g) => (
                <div key={g.title} role="presentation" className="flex flex-col gap-3">
                  <p role="presentation" className="flex items-center gap-2 text-muted-foreground">
                    {g.title}
                    <span className="tabular text-subtle-foreground">{g.agents.length}</span>
                  </p>
                  <div
                    role="presentation"
                    className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
                  >
                    {g.agents.map((a) => (
                      <AgentCard key={a.key} view={a} state={state} {...handlersFor(a)} />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Pílula dos filtros e da visualização (mockup `.pill`). */
const PILL =
  'h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground'

/** Onde o perfil mora (etiqueta do card quando o agente está livre). */
const SCOPE_TAG: Record<AgentView['scope'], string> = {
  builtin: 'Embutido',
  repo: '.orkio/agents',
  local: 'Este computador'
}

/** "Revisor(a) · Embutido": o catálogo do Orkio se distingue dos perfis do time. */
function roleLine(view: AgentView): string {
  if (!view.profile) return view.file
  const role = AGENT_ROLE_LABELS[view.profile.role]
  return view.scope === 'builtin' ? `${role} · Embutido` : role
}

type Filter = AgentFilter | 'archived'

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'waiting', label: 'Esperando você' },
  { value: 'working', label: 'Trabalhando' },
  { value: 'stopped', label: 'Parados' },
  { value: 'archived', label: 'Arquivados' }
]

function matchesFilter(a: AgentView, now: AgentNow, f: Filter): boolean {
  if (f === 'archived') return a.status === 'archived'
  if (a.status === 'archived') return false
  return f === 'all' || now.filter === f
}

/** Ordem da grade: esperando você, trabalhando, depois os parados. */
const ORDER: Record<AgentNow['filter'], number> = { waiting: 0, working: 1, stopped: 2 }

interface AgentHandlers {
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

/** Chip mono do rodapé do card (mockup `.tag`); `hot` = tarefa esperando você. */
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

/** Campo de texto só leitura (prévia do prompt): continua `textbox` com o rótulo como nome. */
function ReadOnlyText({
  label,
  description,
  value,
  rows
}: {
  label: string
  description?: string
  value: string
  rows: number
}): React.JSX.Element {
  return (
    <Field label={label} description={description}>
      {({ id, describedBy }) => (
        <Textarea
          id={id}
          readOnly
          rows={rows}
          value={value}
          aria-describedby={describedBy}
          className="font-mono text-xs text-muted-foreground"
        />
      )}
    </Field>
  )
}

/** Linha de metadados, erros, avisos e a revisão do perfil (igual em linha e card). */
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

/** Ações do agente: Editar e o menu com Duplicar/Arquivar (embutido: só Duplicar). */
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

function AgentRow(
  props: { view: AgentView; state: AgentsState } & AgentHandlers
): React.JSX.Element {
  const { view, now } = props
  const p = view.profile
  const name = p?.name ?? view.id
  const status = STATUS_TOKEN[view.status]
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
        <StatusToken tone={toneOf(status.color)} label={status.label} />
        <AgentActions {...props} />
      </div>
    </li>
  )
}

/**
 * Card do agente (mockup `.ag`): avatar, nome e descrição; o que está fazendo agora e a atividade
 * das últimas horas; avisos e a revisão do perfil; no rodapé, as tarefas dele, vagas e custo.
 */
function AgentCard(
  props: { view: AgentView; state: AgentsState } & AgentHandlers
): React.JSX.Element {
  const { view, now, load } = props
  const p = view.profile
  const name = p?.name ?? view.id
  const status = STATUS_TOKEN[view.status]
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
        {view.status !== 'ready' && (
          <StatusToken tone={toneOf(status.color)} label={status.label} className="ml-1" />
        )}
        {(capacity || cost) && (
          <span className="tabular ml-auto text-2xs text-subtle-foreground">
            {[capacity, cost].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}

function ProfileSummary({
  profile: p,
  state
}: {
  profile: AgentProfile
  state: AgentsState
}): React.JSX.Element {
  const flow = p.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : 'o da coluna'
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        Papel: {AGENT_ROLE_LABELS[p.role]} · Modelo: {AGENT_MODEL_LABELS[p.model] ?? p.model} ·
        Fluxo: {flow}
      </p>
      <p>
        Entrega: {p.delivery ? 'pode (com os gates do Orkio)' : 'não pode'} · Comandos:{' '}
        {p.commands.length === 0 ? 'todos' : p.commands.map((c) => `/${c}`).join(', ')}
      </p>
      <p>
        Limites: {p.limits.parallel} em paralelo · {p.limits.stepsPerDay} execuções/dia
        {p.limits.costPerDayUsd !== null ? ` · US$ ${p.limits.costPerDayUsd}/dia` : ''}
      </p>
    </div>
  )
}

function AgentEditor({
  editing,
  state,
  commands,
  busy,
  onChange,
  onCancel,
  onSave
}: {
  editing: Editing
  state: AgentsState | null
  commands: string[]
  busy: boolean
  onChange(e: Editing): void
  onCancel(): void
  onSave(e: Editing): void
}): React.JSX.Element {
  const supportsEffort = useSupportsEffort()
  const runtimeLabelId = useId()
  const d = editing.draft
  const set = (patch: Partial<AgentProfile>): void =>
    onChange({ ...editing, draft: { ...d, ...patch } })
  const isNew = editing.mode === 'new'
  // Id gerado do nome até você mexer nele (só na criação).
  const [idTouched, setIdTouched] = useState(false)
  const errors = useMemo(() => validateAgent(d), [d])
  const commandOptions = [...new Set([...commands, ...d.commands])].map((c) => ({
    value: c,
    label: `/${c}`
  }))
  const [stepsText, setStepsText] = useState(String(d.limits.stepsPerDay))
  const [costText, setCostText] = useState(
    d.limits.costPerDayUsd === null ? '' : String(d.limits.costPerDayUsd)
  )
  const title = isNew ? 'Novo agente' : `Editar ${d.name}`

  return (
    <div
      role="form"
      aria-label={title}
      className="flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5"
    >
      <h2 className="text-base font-medium">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Nome"
          value={d.name}
          required
          onChange={(name) =>
            set(isNew && !idTouched ? { name, id: agentIdFromName(name) } : { name })
          }
        />
        <TextField
          label="Id"
          description="Nome do arquivo (.orkio/agents/<id>.md). Não muda depois de criado."
          value={d.id}
          mono
          disabled={!isNew}
          onChange={(id) => {
            setIdTouched(true)
            set({ id })
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Papel"
          options={AGENT_ROLES.map((r) => ({ value: r, label: AGENT_ROLE_LABELS[r] }))}
          value={d.role}
          onChange={(role) => set({ role: role as AgentProfile['role'] })}
        />
        <SelectField
          label="Cor"
          options={AGENT_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c] }))}
          value={d.color}
          onChange={(color) => set({ color: color as AgentColor })}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span id={runtimeLabelId} className="text-sm font-medium">
            Modelo e raciocínio
          </span>
          <RuntimePicker
            describedBy={runtimeLabelId}
            value={{ model: d.model === 'default' ? null : d.model, effort: d.effort }}
            supportsEffort={supportsEffort}
            className="w-full justify-start border border-input bg-card"
            onChange={(v) =>
              set({
                model: (v.model ?? 'default') as AgentProfile['model'],
                effort: v.effort ?? null
              })
            }
          />
        </div>
      </div>
      <SelectField
        label="Fluxo preferido"
        description="Usado quando a coluna dispara um fluxo e a tarefa é deste agente. Sem fluxo preferido, roda o fluxo da coluna com as instruções do agente."
        options={[
          { value: '', label: 'O fluxo da coluna' },
          ...(state?.flows ?? []).map((f) => ({ value: f.id, label: f.name }))
        ]}
        value={d.flow ?? ''}
        onChange={(flow) => set({ flow: flow || null })}
      />
      <MultiSelectField
        label="Comandos permitidos"
        placeholder="Todos os comandos"
        options={commandOptions}
        value={d.commands}
        hasSearch
        onChange={(value) => set({ commands: value })}
      />
      <CheckboxField
        label="Pode entregar (push, PR e pedir review, sempre pelos gates do Orkio)"
        checked={d.delivery}
        onChange={(delivery) => set({ delivery })}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Fluxos ao mesmo tempo"
          options={Array.from({ length: AGENT_LIMITS.parallel }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1)
          }))}
          value={String(d.limits.parallel)}
          onChange={(v) => set({ limits: { ...d.limits, parallel: Number(v) } })}
        />
        <TextField
          label="Execuções do Claude Code por dia"
          value={stepsText}
          onChange={(v) => {
            setStepsText(v)
            const n = Number(v)
            set({ limits: { ...d.limits, stepsPerDay: Number.isFinite(n) ? n : 0 } })
          }}
        />
        <TextField
          label="Custo máximo por dia (US$)"
          description="Vazio = sem limite."
          value={costText}
          onChange={(v) => {
            setCostText(v)
            const t = v.trim().replace(',', '.')
            set({ limits: { ...d.limits, costPerDayUsd: t === '' ? null : Number(t) } })
          }}
        />
      </div>
      <TextAreaField
        label="Instruções"
        description="Como este agente trabalha: convenções, o que sempre fazer, o que evitar. Nada de tokens ou senhas."
        value={d.instructions}
        rows={8}
        onChange={(instructions) =>
          set({ instructions: instructions.slice(0, AGENT_LIMITS.instructions) })
        }
      />
      {isNew && (
        <RadioListField
          label="Onde salvar"
          value={editing.scope}
          onChange={(scope) => onChange({ ...editing, scope: scope as AgentScope })}
          options={[
            {
              value: 'repo',
              label: 'No repositório do projeto',
              description:
                'Grava .orkio/agents/<id>.md na pasta do projeto (sem commit). O time usa o mesmo agente.'
            },
            {
              value: 'local',
              label: 'Só neste computador',
              description: 'Vale para todos os seus projetos.'
            }
          ]}
        />
      )}
      <ReadOnlyText
        label="Prévia: o que vai no início da conversa"
        description="Entra com --append-system-prompt. O resumo da tarefa continua igual."
        value={buildAgentPrompt(d)}
        rows={6}
      />
      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || errors.length > 0} onClick={() => onSave(editing)}>
          {busy && <Spinner />}
          Salvar agente
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/** "Tarefas que entram em <etapa> vão para <agente>" (uma por etapa). */
export function AssignRules({
  state,
  onSave
}: {
  state: AgentsState
  onSave(rules: AgentsState['rules']): Promise<void>
}): React.JSX.Element | null {
  const [rules, setRules] = useState(state.rules)
  const [stageId, setStageId] = useState<string>('')
  const [agentKey, setAgentKey] = useState<string>('')
  const usable = state.agents.filter(
    (a) => a.profile && a.status !== 'invalid' && a.status !== 'archived'
  )
  if (state.stages.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Atribuição por coluna</h2>
        <p className="text-xs text-muted-foreground">
          Crie o quadro deste projeto para atribuir tarefas por coluna.
        </p>
      </div>
    )
  }
  const stageName = (id: string): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    state.agents.find((a) => a.key === key)?.profile?.name ?? key
  const free = state.stages.filter((s) => !rules.some((r) => r.stageId === s.id))
  const dirty = JSON.stringify(rules) !== JSON.stringify(state.rules)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4">
      <h2 className="text-sm font-medium">Atribuição por coluna</h2>
      <p className="text-xs text-muted-foreground">
        Tarefa sem agente que entra na coluna (à mão ou por automação) fica com o agente escolhido.
        Se a coluna tem fluxo ligado ao entrar, ele começa com esse agente.
      </p>
      {rules.length > 0 && (
        <ul aria-label="Regras de atribuição" className="rounded-lg border border-border-soft">
          {rules.map((r) => (
            <li
              key={r.stageId}
              className="flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                {`Ao entrar em ${stageName(r.stageId)}, atribuir a ${agentName(r.agentKey)}`}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remover regra de ${stageName(r.stageId)}`}
                onClick={() => setRules(rules.filter((x) => x.stageId !== r.stageId))}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && usable.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            className="w-56"
            label="Ao entrar em"
            placeholder="Escolha a coluna"
            options={free.map((s) => ({ value: s.id, label: s.name }))}
            value={stageId || null}
            onChange={(v) => setStageId(v)}
          />
          <SelectField
            className="w-56"
            label="Atribuir a"
            placeholder="Escolha o agente"
            options={usable.map((a) => ({ value: a.key, label: a.profile!.name }))}
            value={agentKey || null}
            onChange={(v) => setAgentKey(v)}
          />
          <Button
            variant="outline"
            disabled={!stageId || !agentKey}
            onClick={() => {
              setRules([...rules, { stageId, agentKey }])
              setStageId('')
              setAgentKey('')
            }}
          >
            Adicionar regra
          </Button>
        </div>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button onClick={() => void onSave(rules)}>Salvar regras</Button>
          <Button variant="ghost" onClick={() => setRules(state.rules)}>
            Descartar
          </Button>
        </div>
      )}
    </div>
  )
}

/** Carga dos agentes (vagas usadas) pelo estado do orquestrador do projeto. */
function useOrchestrator(projectId: string | null): OrchestratorState | null {
  const [state, setState] = useState<{ projectId: string; value: OrchestratorState } | null>(null)
  useEffect(() => {
    if (!projectId) return
    let alive = true
    const load = (): void => {
      void window.orkio.agents
        .orchestrator(projectId)
        .then((r) => {
          if (alive && r.ok) setState({ projectId, value: r.value })
        })
        .catch(() => undefined)
    }
    load()
    const off = window.orkio.agents.onChanged((e) => {
      if (e.projectId === projectId) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId])
  return state && state.projectId === projectId ? state.value : null
}

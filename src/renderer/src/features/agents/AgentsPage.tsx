import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Grid } from '@astryxdesign/core/Grid'
import { Item } from '@astryxdesign/core/Item'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { List } from '@astryxdesign/core/List'
import { MultiSelector } from '@astryxdesign/core/MultiSelector'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Token } from '@astryxdesign/core/Token'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { VStack } from '@astryxdesign/core/VStack'
import {
  AGENT_COLORS,
  AGENT_LIMITS,
  AGENT_MODEL_LABELS,
  AGENT_MODELS,
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
import type { ProjectView } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/PageHeader'
import { isTextField } from '../../app/shortcuts'
import { BoardIcon, ListIcon, PlusIcon, TrashIcon } from '../../components/icons'
import { AgentAvatar } from './AgentAvatar'
import { agentNow, type AgentFilter, type AgentNow } from './agent-state'
import { useAgentBadges } from './agent-badges'
import { Sparkline } from './Sparkline'
import { useOverview } from '../overview/useOverview'
import { formatUsd } from '../../lib/format'
import type { OrchestratorAgentLoad, OrchestratorState } from '../../../../shared/orchestrator'

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
  const searchBox = useRef<HTMLDivElement | null>(null)

  // "/" foca a busca (fora de campos de texto), como nas listas das referências.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return
      const input = searchBox.current?.querySelector('input')
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

  if (projects === null) return <Skeleton height={240} aria-label="Carregando agentes" />

  const header = (
    <PageHeader
      title="Agentes"
      subtitle="Colegas de IA com nome, papel e instruções que pegam tarefas do quadro, dentro das regras do Orkio."
      action={
        <HStack gap={2} vAlign="center">
          {projects.length > 1 && (
            <Selector
              label="Projeto"
              isLabelHidden
              width={240}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              {...(projectId ? { value: projectId } : {})}
              onChange={(value: string) => {
                setState(null)
                setEditing(null)
                setProjectId(value)
              }}
            />
          )}
          {projectId && onOpenOrchestrator && (
            <Button
              variant="secondary"
              label={`Orquestrador: ${orchestrator?.config.enabled ? 'ligado' : 'desligado'}`}
              onClick={onOpenOrchestrator}
            />
          )}
          {projectId && (
            <Button
              variant="primary"
              label="Novo agente"
              icon={<Icon icon={PlusIcon} />}
              onClick={() => {
                setMessage(null)
                setEditing({ mode: 'new', scope: 'repo', draft: defaultAgent(), key: null })
              }}
            />
          )}
        </HStack>
      }
    />
  )

  if (!projectId) {
    return (
      <VStack gap={5}>
        {header}
        <EmptyState
          title="Nenhum projeto ainda"
          description="Adicione um projeto em Projetos para criar agentes para ele."
        />
      </VStack>
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

  return (
    <VStack gap={5} role="region" aria-label="Agentes">
      {header}
      <Text type="supporting">
        O Orkio roda o Claude Code instalado por você, sem modificação e com o seu login. Um agente
        é um conjunto de instruções, modelo, fluxo preferido e limites por cima disso: ele nunca
        ganha permissões. Push, PR e gates continuam pelas regras do Orkio. O Orkio não usa o Agent
        SDK nem guarda credenciais da Anthropic.
      </Text>
      {message &&
        (message.tone === 'error' ? (
          <Alert tone="danger">{message.text}</Alert>
        ) : (
          <Text role="status">{message.text}</Text>
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
        <Skeleton height={120} aria-label="Carregando agentes" />
      ) : state.agents.length === 0 && !editing ? (
        <EmptyState
          title="Nenhum agente ainda"
          description="Crie um agente (ex.: Ana, implementadora) e atribua tarefas a ele no quadro."
        />
      ) : (
        <VStack gap={3}>
          <HStack
            gap={3}
            vAlign="center"
            wrap="wrap"
            role="toolbar"
            aria-label="Filtros de agentes"
          >
            <HStack ref={searchBox}>
              <TextInput
                type="search"
                label="Buscar agentes"
                isLabelHidden
                placeholder="Buscar agentes  /"
                hasClear
                value={query}
                onChange={setQuery}
              />
            </HStack>
            <SegmentedControl
              label="Filtrar por estado"
              size="sm"
              value={filter}
              onChange={(v) => setFilter(FILTERS.find((f) => f.value === v)?.value ?? 'all')}
            >
              {FILTERS.map((f) => (
                <SegmentedControlItem
                  key={f.value}
                  value={f.value}
                  label={`${f.label} ${
                    state.agents.filter((a) => matchesFilter(a, allNow.get(a.key)!, f.value)).length
                  }`}
                />
              ))}
            </SegmentedControl>
            <StackItem size="fill" />
            <SegmentedControl
              label="Visualização dos agentes"
              size="sm"
              value={layout}
              onChange={(v) => setLayout(v === 'rows' ? 'rows' : 'cards')}
            >
              <SegmentedControlItem value="cards" label="Cards" icon={<Icon icon={BoardIcon} />} />
              <SegmentedControlItem value="rows" label="Linhas" icon={<Icon icon={ListIcon} />} />
            </SegmentedControl>
          </HStack>
          {visibleAgents.length === 0 ? (
            <Text type="supporting" color="secondary">
              Nenhum agente com esse filtro.
            </Text>
          ) : layout === 'rows' ? (
            <List hasDividers aria-label="Lista de agentes">
              {visibleAgents.map((a) => (
                <AgentRow key={a.key} view={a} state={state} {...handlersFor(a)} />
              ))}
            </List>
          ) : (
            <Grid columns={{ minWidth: 280 }} gap={3} role="list" aria-label="Lista de agentes">
              {visibleAgents.map((a) => (
                <AgentCard key={a.key} view={a} state={state} {...handlersFor(a)} />
              ))}
            </Grid>
          )}
        </VStack>
      )}
    </VStack>
  )
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

/** Linha de metadados, erros, avisos e a revisão do perfil (igual em linha e card). */
function AgentDetails({
  view,
  state,
  isReviewing,
  busy,
  onReview,
  onApprove
}: { view: AgentView; state: AgentsState } & AgentHandlers): React.JSX.Element {
  const p = view.profile
  const name = p?.name ?? view.id
  const flowName = p?.flow ? (state.flows.find((f) => f.id === p.flow)?.name ?? p.flow) : null
  const details = [
    view.assigned === 1 ? '1 tarefa' : `${view.assigned} tarefas`,
    view.usageToday.runs === 1 ? '1 execução hoje' : `${view.usageToday.runs} execuções hoje`,
    flowName ? `fluxo ${flowName}` : null
  ].filter(Boolean)
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">
        {details.join(' · ')}
      </Text>
      {view.errors.map((e) => (
        <Alert key={e} tone="danger">
          {e}
        </Alert>
      ))}
      {view.warnings.map((w) => (
        <Text key={w} type="supporting">
          {w}
        </Text>
      ))}
      {view.status === 'needs_review' && p && (
        <Alert tone="warning">
          O perfil de {name} mudou no repositório desde a última aprovação. Revise antes de ele
          rodar de novo.
        </Alert>
      )}
      {isReviewing && p && (
        <VStack gap={3}>
          <ProfileSummary profile={p} state={state} />
          <TextArea
            label="O que vai no início da conversa"
            value={buildAgentPrompt(p)}
            isReadOnly
            rows={8}
            onChange={() => undefined}
          />
          <HStack gap={2}>
            <Button
              size="sm"
              variant="primary"
              label="Aprovar este perfil"
              isLoading={busy}
              onClick={onApprove}
            />
            <Button size="sm" variant="ghost" label="Fechar" onClick={onReview} />
          </HStack>
        </VStack>
      )}
    </VStack>
  )
}

/** Ações do agente: Revisar (quando pede), Editar e o menu com Duplicar/Arquivar. */
function AgentActions({
  view,
  isReviewing,
  onEdit,
  onDuplicate,
  onArchive,
  onReview
}: { view: AgentView } & AgentHandlers): React.JSX.Element | null {
  const p = view.profile
  const name = p?.name ?? view.id
  return (
    <HStack gap={1} vAlign="center">
      {view.status === 'needs_review' && p && !isReviewing && (
        <Button size="sm" variant="secondary" label={`Revisar ${name}`} onClick={onReview} />
      )}
      {p && view.scope === 'builtin' && (
        <Button size="sm" variant="ghost" label={`Duplicar ${name}`} onClick={onDuplicate} />
      )}
      {p && view.scope !== 'builtin' && (
        <>
          <Button size="sm" variant="ghost" label={`Editar ${name}`} onClick={onEdit} />
          <MoreMenu
            label={`Ações de ${name}`}
            size="sm"
            items={[
              { label: `Duplicar ${name}`, onClick: onDuplicate },
              { label: p.archived ? `Desarquivar ${name}` : `Arquivar ${name}`, onClick: onArchive }
            ]}
          />
        </>
      )}
    </HStack>
  )
}

function AgentRow(
  props: { view: AgentView; state: AgentsState } & AgentHandlers
): React.JSX.Element {
  const { view } = props
  const p = view.profile
  const name = p?.name ?? view.id
  const status = STATUS_TOKEN[view.status]
  return (
    <Item
      as="li"
      align="start"
      startContent={<AgentAvatar name={name} color={p?.color ?? 'yellow'} seed={view.key} />}
      label={name}
      description={
        <VStack gap={1}>
          {p && <Text type="supporting">{roleLine(view)}</Text>}
          <AgentDetails {...props} />
        </VStack>
      }
      endContent={
        <HStack gap={2} vAlign="center">
          <StatusToken tone={toneOf(status.color)} label={status.label} />
          <AgentActions {...props} />
        </HStack>
      }
    />
  )
}

/**
 * Card do agente (estilo das referências): avatar, nome e papel; o que está fazendo agora e a
 * atividade das últimas horas; as tarefas dele; vagas e custo do dia; ações no rodapé.
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
    <Card padding={4} role="listitem" aria-label={name} data-testid="agent-card">
      <VStack gap={3} height="100%">
        <HStack gap={3} vAlign="center">
          <AgentAvatar name={name} color={p?.color ?? 'yellow'} seed={view.key} size="lg" />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Text weight="semibold" maxLines={1}>
                {name}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {p
                  ? (p.instructions.split('\n').find((l) => l.trim()) ?? roleLine(view))
                  : view.file}
              </Text>
            </VStack>
          </StackItem>
          {view.scope === 'builtin' && <Token label="Embutido" size="sm" />}
          {view.status !== 'ready' && (
            <StatusToken tone={toneOf(status.color)} label={status.label} />
          )}
        </HStack>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <StatusToken tone={now.tone} label={now.text} data-testid="agent-now" />
          </StackItem>
          <Sparkline
            values={view.activity}
            label={`${view.activity.reduce((x, y) => x + y, 0)} execuções nas últimas 12 horas`}
          />
        </HStack>
        <StackItem size="fill">
          <AgentDetails {...props} />
        </StackItem>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {now.tasks.slice(0, 3).map((t) => (
            <Code key={t.taskId}>{`${t.hot ? '● ' : ''}${t.displayId ?? 'tarefa'}`}</Code>
          ))}
          <StackItem size="fill" />
          {(capacity || cost) && (
            <Text type="supporting" color="secondary">
              {[capacity, cost].filter(Boolean).join(' · ')}
            </Text>
          )}
          <AgentActions {...props} />
        </HStack>
      </VStack>
    </Card>
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
    <VStack gap={1}>
      <Text type="supporting">
        Papel: {AGENT_ROLE_LABELS[p.role]} · Modelo: {AGENT_MODEL_LABELS[p.model]} · Fluxo: {flow}
      </Text>
      <Text type="supporting">
        Entrega: {p.delivery ? 'pode (com os gates do Orkio)' : 'não pode'} · Comandos:{' '}
        {p.commands.length === 0 ? 'todos' : p.commands.map((c) => `/${c}`).join(', ')}
      </Text>
      <Text type="supporting">
        Limites: {p.limits.parallel} em paralelo · {p.limits.stepsPerDay} execuções/dia
        {p.limits.costPerDayUsd !== null ? ` · US$ ${p.limits.costPerDayUsd}/dia` : ''}
      </Text>
    </VStack>
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

  return (
    <Card role="form" aria-label={isNew ? 'Novo agente' : `Editar ${d.name}`}>
      <VStack gap={4}>
        <Heading level={2}>{isNew ? 'Novo agente' : `Editar ${d.name}`}</Heading>
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <TextInput
              label="Nome"
              value={d.name}
              isRequired
              onChange={(name: string) =>
                set(isNew && !idTouched ? { name, id: agentIdFromName(name) } : { name })
              }
            />
          </StackItem>
          <StackItem size="fill">
            <TextInput
              label="Id"
              description="Nome do arquivo (.orkio/agents/<id>.md). Não muda depois de criado."
              value={d.id}
              isDisabled={!isNew}
              onChange={(id: string) => {
                setIdTouched(true)
                set({ id })
              }}
            />
          </StackItem>
        </HStack>
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <Selector
              label="Papel"
              options={AGENT_ROLES.map((r) => ({ value: r, label: AGENT_ROLE_LABELS[r] }))}
              value={d.role}
              onChange={(role: string) => set({ role: role as AgentProfile['role'] })}
            />
          </StackItem>
          <StackItem size="fill">
            <Selector
              label="Cor"
              options={AGENT_COLORS.map((c) => ({ value: c, label: COLOR_LABELS[c] }))}
              value={d.color}
              onChange={(color: string) => set({ color: color as AgentColor })}
            />
          </StackItem>
          <StackItem size="fill">
            <Selector
              label="Modelo"
              options={AGENT_MODELS.map((m) => ({ value: m, label: AGENT_MODEL_LABELS[m] }))}
              value={d.model}
              onChange={(model: string) => set({ model: model as AgentProfile['model'] })}
            />
          </StackItem>
        </HStack>
        <Selector
          label="Fluxo preferido"
          description="Usado quando a coluna dispara um fluxo e a tarefa é deste agente. Sem fluxo preferido, roda o fluxo da coluna com as instruções do agente."
          options={[
            { value: '', label: 'O fluxo da coluna' },
            ...(state?.flows ?? []).map((f) => ({ value: f.id, label: f.name }))
          ]}
          value={d.flow ?? ''}
          onChange={(flow: string) => set({ flow: flow || null })}
        />
        <MultiSelector
          label="Comandos permitidos"
          placeholder="Todos os comandos"
          options={commandOptions}
          value={d.commands}
          triggerDisplay="labels"
          hasSearch
          onChange={(value: string[]) => set({ commands: value })}
        />
        <CheckboxInput
          label="Pode entregar (push, PR e pedir review, sempre pelos gates do Orkio)"
          value={d.delivery}
          onChange={(delivery) => set({ delivery })}
        />
        <HStack gap={3} wrap="wrap">
          <StackItem size="fill">
            <Selector
              label="Fluxos ao mesmo tempo"
              options={Array.from({ length: AGENT_LIMITS.parallel }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1)
              }))}
              value={String(d.limits.parallel)}
              onChange={(v: string) => set({ limits: { ...d.limits, parallel: Number(v) } })}
            />
          </StackItem>
          <StackItem size="fill">
            <TextInput
              label="Execuções do Claude Code por dia"
              value={stepsText}
              onChange={(v: string) => {
                setStepsText(v)
                const n = Number(v)
                set({ limits: { ...d.limits, stepsPerDay: Number.isFinite(n) ? n : 0 } })
              }}
            />
          </StackItem>
          <StackItem size="fill">
            <TextInput
              label="Custo máximo por dia (US$)"
              description="Vazio = sem limite."
              value={costText}
              onChange={(v: string) => {
                setCostText(v)
                const t = v.trim().replace(',', '.')
                set({ limits: { ...d.limits, costPerDayUsd: t === '' ? null : Number(t) } })
              }}
            />
          </StackItem>
        </HStack>
        <TextArea
          label="Instruções"
          description="Como este agente trabalha: convenções, o que sempre fazer, o que evitar. Nada de tokens ou senhas."
          value={d.instructions}
          maxLength={AGENT_LIMITS.instructions}
          rows={8}
          onChange={(instructions) => set({ instructions })}
        />
        {isNew && (
          <RadioList
            label="Onde salvar"
            value={editing.scope}
            onChange={(scope) => onChange({ ...editing, scope: scope as AgentScope })}
          >
            <RadioListItem
              value="repo"
              label="No repositório do projeto"
              description="Grava .orkio/agents/<id>.md na pasta do projeto (sem commit). O time usa o mesmo agente."
            />
            <RadioListItem
              value="local"
              label="Só neste computador"
              description="Vale para todos os seus projetos."
            />
          </RadioList>
        )}
        <TextArea
          label="Prévia: o que vai no início da conversa"
          description="Entra com --append-system-prompt. O resumo da tarefa continua igual."
          value={buildAgentPrompt(d)}
          isReadOnly
          rows={6}
          onChange={() => undefined}
        />
        {errors.length > 0 && (
          <VStack gap={1}>
            {errors.map((e) => (
              <Text key={e} type="supporting">
                {e}
              </Text>
            ))}
          </VStack>
        )}
        <HStack gap={2}>
          <Button
            variant="primary"
            label="Salvar agente"
            isLoading={busy}
            isDisabled={errors.length > 0}
            onClick={() => onSave(editing)}
          />
          <Button variant="ghost" label="Cancelar" onClick={onCancel} />
        </HStack>
      </VStack>
    </Card>
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
      <VStack gap={2}>
        <Heading level={2}>Atribuição por coluna</Heading>
        <Text type="supporting">Crie o quadro deste projeto para atribuir tarefas por coluna.</Text>
      </VStack>
    )
  }
  const stageName = (id: string): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    state.agents.find((a) => a.key === key)?.profile?.name ?? key
  const free = state.stages.filter((s) => !rules.some((r) => r.stageId === s.id))
  const dirty = JSON.stringify(rules) !== JSON.stringify(state.rules)

  return (
    <VStack gap={3}>
      <Heading level={2}>Atribuição por coluna</Heading>
      <Text type="supporting">
        Tarefa sem agente que entra na coluna (à mão ou por automação) fica com o agente escolhido.
        Se a coluna tem fluxo ligado ao entrar, ele começa com esse agente.
      </Text>
      {rules.length > 0 && (
        <List hasDividers density="compact" aria-label="Regras de atribuição">
          {rules.map((r) => (
            <Item
              as="li"
              key={r.stageId}
              label={`Ao entrar em ${stageName(r.stageId)}, atribuir a ${agentName(r.agentKey)}`}
              endContent={
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  label={`Remover regra de ${stageName(r.stageId)}`}
                  icon={<Icon icon={TrashIcon} />}
                  onClick={() => setRules(rules.filter((x) => x.stageId !== r.stageId))}
                />
              }
            />
          ))}
        </List>
      )}
      {free.length > 0 && usable.length > 0 && (
        <HStack gap={2} vAlign="end" wrap="wrap">
          <Selector
            label="Ao entrar em"
            placeholder="Escolha a coluna"
            options={free.map((s) => ({ value: s.id, label: s.name }))}
            {...(stageId ? { value: stageId } : {})}
            onChange={(v: string) => setStageId(v)}
          />
          <Selector
            label="Atribuir a"
            placeholder="Escolha o agente"
            options={usable.map((a) => ({ value: a.key, label: a.profile!.name }))}
            {...(agentKey ? { value: agentKey } : {})}
            onChange={(v: string) => setAgentKey(v)}
          />
          <Button
            variant="secondary"
            label="Adicionar regra"
            isDisabled={!stageId || !agentKey}
            onClick={() => {
              setRules([...rules, { stageId, agentKey }])
              setStageId('')
              setAgentKey('')
            }}
          />
        </HStack>
      )}
      {dirty && (
        <HStack gap={2}>
          <Button variant="primary" label="Salvar regras" onClick={() => void onSave(rules)} />
          <Button variant="ghost" label="Descartar" onClick={() => setRules(state.rules)} />
        </HStack>
      )}
    </VStack>
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

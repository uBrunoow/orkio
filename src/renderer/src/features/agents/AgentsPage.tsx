import { useRef, useState } from 'react'
import { AGENT_ROLE_LABELS, defaultAgent, type AgentView } from '../../../../shared/agent'
import { normalizeLabel } from '../../../../shared/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { Alert } from '../../components/Alert'
import { EmptyState } from '../../components/PageState'
import { ScreenTitle } from '../../components/ScreenTitle'
import { GridIcon, ListIcon, PlusIcon } from '../../components/icons'
import { useSlashFocus } from '../../lib/useSlashFocus'
import { useOverview } from '../overview/useOverview'
import { useProjects } from '../projects/useProjects'
import { AgentCard, AgentRow, type AgentHandlers } from './AgentCards'
import { AgentDetail, type AgentSetupPart } from './AgentDetail'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AgentEditor, type Editing } from './AgentEditor'
import { OrchestratorCard, OrchestratorDetail, OrchestratorRow } from './OrchestratorAgent'
import { AgentMemory } from './AgentMemory'
import { useAgentBadges } from './agent-badges'
import { agentNow, type AgentFilter, type AgentNow } from './agent-state'
import { useAgentsState, useCommandNames, useOrchestrator } from './useAgents'
import { ipcResult } from '../../lib/ipc'
import { SURFACE } from '../../components/surface'

export function AgentsPage({
  projectId: currentProjectId = null
}: {
  /** Projeto atual (as tarefas e a carga dos agentes são deste projeto). */
  projectId?: string | null
} = {}): React.JSX.Element {
  const projects = useProjects().projects?.filter((p) => !p.archived) ?? null
  const [chosen, setChosen] = useState<string | null>(null)
  const projectId =
    chosen ??
    (currentProjectId && projects?.some((p) => p.id === currentProjectId)
      ? currentProjectId
      : (projects?.[0]?.id ?? null))
  const agents = useAgentsState(projectId)
  const state = agents.value
  const [editing, setEditing] = useState<Editing | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  /** Fase 3: agente com a Memória aberta (no lugar da lista). */
  const [memoryOf, setMemoryOf] = useState<string | null>(null)
  /** Página aberta no lugar da lista: a chave do agente ou o orquestrador. */
  const [detailOf, setDetailOf] = useState<string | null>(null)
  /** O editor abre no Avançado quando a página pediu ferramentas, permissões ou limites. */
  const [editAdvanced, setEditAdvanced] = useState(false)
  const commands = useCommandNames(projectId)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [layout, setLayout] = useState<'cards' | 'rows'>('cards')
  const searchInput = useRef<HTMLInputElement | null>(null)
  useSlashFocus(searchInput)

  const badges = useAgentBadges(projectId)
  const { snapshot } = useOverview()
  const orchestrator = useOrchestrator(projectId).value
  const loadError = agents.error?.message ?? null

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
                setEditing(null)
                setMemoryOf(null)
                setDetailOf(null)
                setChosen(value)
              }}
            />
          )}
          {projectId && (
            <Button
              onClick={() => {
                setMessage(null)
                setMemoryOf(null)
                setDetailOf(null)
                setEditAdvanced(false)
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
    const r = await ipcResult(() =>
      window.orkio.agents.save({
        projectId,
        scope: e.scope,
        profile: e.draft,
        isNew: e.mode === 'new'
      })
    )
    setBusy(false)
    if (!r.ok) {
      setMessage({ tone: 'error', text: r.error.message })
      return
    }
    agents.set(r.value)
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
    const r = await ipcResult(() => window.orkio.agents.approve(projectId, view.key, view.hash))
    setBusy(false)
    if (r.ok) {
      agents.set(r.value)
      setReviewing(null)
      setMessage({ tone: 'ok', text: `Perfil de ${view.profile?.name ?? view.id} aprovado.` })
    } else setMessage({ tone: 'error', text: r.error.message })
  }

  const q = normalizeLabel(query)
  const nowOf = (a: AgentView): AgentNow => agentNow({ agent: a, badges, snapshot, projectId })
  const allNow = new Map((state?.agents ?? []).map((a) => [a.key, nowOf(a)]))
  const visibleAgents = (state?.agents ?? [])
    .filter(
      (a) =>
        matchesFilter(a, allNow.get(a.key)!, filter) &&
        (!q ||
          normalizeLabel(a.profile?.name ?? a.id).includes(q) ||
          normalizeLabel(a.profile?.description ?? '').includes(q) ||
          normalizeLabel(a.profile?.group ?? '').includes(q) ||
          (a.profile ? normalizeLabel(AGENT_ROLE_LABELS[a.profile.role]).includes(q) : false))
    )
    .sort((a, b) => ORDER[allNow.get(a.key)!.filter] - ORDER[allNow.get(b.key)!.filter])
  const countOf = (f: Filter): number =>
    (state?.agents ?? []).filter((a) => matchesFilter(a, allNow.get(a.key)!, f)).length
  const edit = (a: AgentView, part: AgentSetupPart): void => {
    if (!a.profile || a.scope === 'builtin') return
    setMessage(null)
    setEditAdvanced(part === 'tools' || part === 'permissions' || part === 'limits')
    setEditing({ mode: 'edit', scope: a.scope, draft: a.profile, key: a.key })
  }
  const handlersFor = (a: AgentView): AgentHandlers => ({
    isReviewing: reviewing === a.key,
    busy,
    now: allNow.get(a.key)!,
    load: orchestrator?.agents.find((l) => l.key === a.key) ?? null,
    onEdit: () => edit(a, 'instructions'),
    onOpen: () => {
      setMessage(null)
      setEditing(null)
      setMemoryOf(null)
      setDetailOf(a.key)
    },
    onDuplicate: () => {
      if (!a.profile) return
      setMessage(null)
      setDetailOf(null)
      setEditAdvanced(false)
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
    onApprove: () => void approve(a),
    onMemory: () => {
      setMessage(null)
      setEditing(null)
      setMemoryOf(a.key)
    }
  })
  const memoryAgent = memoryOf ? (state?.agents.find((a) => a.key === memoryOf) ?? null) : null
  const detailAgent =
    detailOf && detailOf !== ORCHESTRATOR
      ? (state?.agents.find((a) => a.key === detailOf) ?? null)
      : null
  const showOrchestrator = detailOf === ORCHESTRATOR && state !== null
  const hasAgents = state !== null && state.agents.length > 0
  // O orquestrador entra na lista com os agentes (some só quando a busca ou o filtro não casam).
  const showOrchestratorCard =
    (filter === 'all' || (filter === 'working' && (orchestrator?.status.working ?? 0) > 0)) &&
    (!q || normalizeLabel('Orquestrador').includes(q))
  const orchestratorWorking = (orchestrator?.status.working ?? 0) > 0

  return (
    <div role="region" aria-label="Agentes" className="-mx-6 -mt-5 flex flex-col">
      {header}
      {hasAgents && !detailOf && !memoryOf && editing?.mode !== 'edit' && (
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
        {loadError && !message && <Alert tone="danger">{loadError}</Alert>}
        {message &&
          !(editing?.mode === 'new' && message.tone === 'error') &&
          (message.tone === 'error' ? (
            <Alert tone="danger">{message.text}</Alert>
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {message.text}
            </p>
          ))}

        {memoryAgent && (
          <AgentMemory
            key={memoryAgent.key}
            projectId={projectId}
            agent={memoryAgent}
            onBack={() => setMemoryOf(null)}
          />
        )}

        {showOrchestrator && editing?.mode !== 'edit' && (
          <OrchestratorDetail
            projectId={projectId}
            agents={state}
            onBack={() => setDetailOf(null)}
          />
        )}

        {detailAgent && editing?.mode !== 'edit' && !memoryAgent && (
          <AgentDetail
            key={detailAgent.key}
            projectId={projectId}
            view={detailAgent}
            state={state!}
            {...handlersFor(detailAgent)}
            onBack={() => setDetailOf(null)}
            onEdit={(part) => edit(detailAgent, part)}
            onSaveProfile={(profile) =>
              void save({
                mode: 'edit',
                scope: detailAgent.scope,
                draft: profile,
                key: detailAgent.key
              })
            }
          />
        )}

        {editing && editing.mode === 'edit' && (
          <AgentEditor
            key={editing.key ?? 'novo'}
            initialAdvanced={editAdvanced}
            editing={editing}
            state={state}
            commands={commands}
            busy={busy}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={(e) => void save(e)}
          />
        )}

        <Dialog
          open={editing?.mode === 'new'}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null)
              setMessage(null)
            }
          }}
        >
          <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto sm:max-w-4xl">
            {editing?.mode === 'new' && (
              <AgentEditor
                key="novo"
                bare
                initialAdvanced={editAdvanced}
                editing={editing}
                state={state}
                commands={commands}
                busy={busy}
                error={message?.tone === 'error' ? message.text : null}
                onChange={setEditing}
                onCancel={() => {
                  setEditing(null)
                  setMessage(null)
                }}
                onSave={(e) => void save(e)}
              />
            )}
          </DialogContent>
        </Dialog>

        {memoryAgent || detailAgent || showOrchestrator ? null : state === null ? (
          <Skeleton className="h-30" aria-label="Carregando agentes" />
        ) : state.agents.length === 0 ? (
          editing?.mode !== 'edit' && (
            <EmptyState
              title="Nenhum agente ainda"
              description="Crie um agente (ex.: Ana, implementadora) e atribua tarefas a ele no quadro."
            />
          )
        ) : visibleAgents.length === 0 && !showOrchestratorCard ? (
          <p className="text-xs text-muted-foreground">Nenhum agente com esse filtro.</p>
        ) : layout === 'rows' ? (
          <ul aria-label="Lista de agentes" className={SURFACE.list}>
            {showOrchestratorCard && (
              <OrchestratorRow
                state={orchestrator}
                agents={state}
                onOpen={() => setDetailOf(ORCHESTRATOR)}
              />
            )}
            {visibleAgents.map((a) => (
              <AgentRow key={a.key} view={a} state={state} {...handlersFor(a)} />
            ))}
          </ul>
        ) : (
          <div role="list" aria-label="Lista de agentes" className="flex flex-col gap-5">
            {[
              {
                title: 'Trabalhando agora',
                orchestrator: showOrchestratorCard && orchestratorWorking,
                agents: visibleAgents.filter((a) => allNow.get(a.key)!.filter !== 'stopped')
              },
              {
                title: filter === 'archived' ? 'Arquivados' : 'Disponíveis',
                orchestrator: showOrchestratorCard && !orchestratorWorking,
                agents: visibleAgents.filter((a) => allNow.get(a.key)!.filter === 'stopped')
              }
            ]
              .filter((g) => g.agents.length > 0 || g.orchestrator)
              .map((g) => (
                <div key={g.title} role="presentation" className="flex flex-col gap-3">
                  <p role="presentation" className="flex items-center gap-2 text-muted-foreground">
                    {g.title}
                    <span className="tabular text-subtle-foreground">
                      {g.agents.length + (g.orchestrator ? 1 : 0)}
                    </span>
                  </p>
                  <div
                    role="presentation"
                    className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
                  >
                    {g.orchestrator && (
                      <OrchestratorCard
                        state={orchestrator}
                        agents={state}
                        onOpen={() => setDetailOf(ORCHESTRATOR)}
                      />
                    )}
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

/** `detailOf` do orquestrador (não é chave de agente: as chaves têm `escopo:`). */
const ORCHESTRATOR = 'orchestrator'

const PILL =
  'h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground'

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

const ORDER: Record<AgentNow['filter'], number> = { waiting: 0, working: 1, stopped: 2 }

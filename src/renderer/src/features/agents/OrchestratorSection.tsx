import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField, SelectField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { Timestamp } from '@/components/Timestamp'
import { MultiSelectField } from './MultiSelectField'
import { useOrchestrator } from './useAgents'
import { isUsableAgent, type AgentsState } from '../../../../shared/agent'
import {
  ORCHESTRATOR_LIMITS,
  suggestOrchestrator,
  validateOrchestrator,
  type OrchestratorConfig,
  type OrchestratorLane,
  type OrchestratorState
} from '../../../../shared/orchestrator'
import { Alert } from '../../components/Alert'
import { PlusIcon, TrashIcon } from '../../components/icons'
import { StatusBadge, StatusToken } from '../../components/StatusToken'
import { cn } from '@/lib/utils'
import { AgentAvatar } from './AgentAvatar'
import { OrchestratorFace } from './OrchestratorAgent'
import { plural } from '../../lib/format'
import { ipcResult } from '../../lib/ipc'

export function OrchestratorSection({
  projectId,
  agents
}: {
  projectId: string
  agents: AgentsState
}): React.JSX.Element {
  const orchestrator = useOrchestrator(projectId)
  const state = orchestrator.value
  const [draft, setDraft] = useState<OrchestratorConfig | null>(null)
  const [actionError, setError] = useState<string | null>(null)
  const error = actionError ?? orchestrator.error?.message ?? null
  const [busy, setBusy] = useState(false)
  // Regras ou perfis mudaram (salvos nesta tela): a carga dos agentes muda junto.
  const reload = orchestrator.reload
  useEffect(() => {
    void reload()
  }, [agents, reload])

  if (!state) return <p className="text-xs text-muted-foreground">Carregando o orquestrador…</p>

  const stageName = (id: string | null): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    agents.agents.find((a) => a.key === key)?.profile?.name ?? key
  const { config, status } = state

  const run = async (): Promise<void> => {
    setBusy(true)
    const r = await ipcResult(() => window.orkio.agents.runOrchestrator(projectId))
    setBusy(false)
    if (r.ok) orchestrator.set(r.value)
    else setError(r.error.message)
  }

  const save = async (next: OrchestratorConfig): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await ipcResult(() => window.orkio.agents.saveOrchestrator(projectId, next))
    setBusy(false)
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    orchestrator.set(r.value)
    setDraft(null)
  }

  const face = (key: string, size: 'sm' | 'md' = 'sm'): React.JSX.Element => {
    const a = agents.agents.find((x) => x.key === key)
    return (
      <AgentAvatar
        name={agentName(key)}
        color={a?.profile?.color ?? 'yellow'}
        seed={key}
        size={size}
      />
    )
  }
  const chain = orchestratorChain(config)

  return (
    <section
      aria-label="Orquestrador"
      className="overflow-hidden rounded-xl border border-border-soft bg-card"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border-soft bg-surface/60 px-4 py-3">
        <OrchestratorFace size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">Orquestrador</h2>
            <StatusBadge
              tone={!config.enabled ? 'neutral' : status.working > 0 ? 'running' : 'success'}
              label={
                !config.enabled
                  ? 'Desligado'
                  : status.working > 0
                    ? `${plural(status.working, 'tarefa', 'tarefas')} em andamento`
                    : 'Ligado'
              }
            />
          </span>
          <span className="text-xs text-muted-foreground">
            Passa a tarefa ao agente de cada etapa e para a seguinte quando o fluxo termina bem.
          </span>
        </div>
        {config.enabled && !draft && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
            {busy && <Spinner />}
            Rodar agora
          </Button>
        )}
        {!draft && (
          <Button
            size="sm"
            variant={config.lanes.length === 0 ? 'default' : 'outline'}
            onClick={() => {
              setError(null)
              setDraft(
                config.lanes.length === 0 && !config.enabled
                  ? suggestOrchestrator(state.stages)
                  : structuredClone(config)
              )
            }}
          >
            Configurar orquestrador
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-xs text-muted-foreground">
          Você decide quando uma tarefa começa: mova para a primeira etapa de trabalho. Gates, push
          e falhas continuam parando em você.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}

        {draft ? (
          <OrchestratorEditor
            draft={draft}
            state={state}
            agents={agents}
            busy={busy}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={(d) => void save(d)}
          />
        ) : config.lanes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-soft px-4 py-5 text-center text-xs text-muted-foreground">
            Ainda não configurado. “Configurar orquestrador” sugere um caminho pelas etapas do
            quadro e pelos agentes embutidos.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* O caminho: etapa (com os agentes) → próxima etapa. */}
            <div aria-hidden="true" className="flex flex-wrap items-center gap-1.5">
              {chain.map((step, i) => (
                <span key={`${step.stageId}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-subtle-foreground">→</span>}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface py-0.5 pr-2.5 pl-1">
                    {step.agents.length > 0 ? (
                      <span className="flex -space-x-1">{step.agents.map((k) => face(k))}</span>
                    ) : (
                      <span className="size-1.5 rounded-full bg-subtle-foreground" />
                    )}
                    <span className="text-xs text-foreground">{stageName(step.stageId)}</span>
                  </span>
                </span>
              ))}
            </div>
            <p data-testid="orchestrator-summary" className="text-xs text-muted-foreground">
              {orchestratorSummary(config, stageName, agentName)}
            </p>
            {config.enabled && (
              <p className="text-2xs text-subtle-foreground">
                {status.lastRunAt ? (
                  <>
                    Última rodada <Timestamp value={status.lastRunAt} />
                  </>
                ) : (
                  'Primeira rodada no próximo ciclo (até 1 min)'
                )}
                {` · ${plural(status.working, 'tarefa', 'tarefas')} com agente agora`}
              </p>
            )}
            {status.error && <Alert tone="warning">{status.error}</Alert>}
            {state.validation.warnings.map((w) => (
              <Alert key={w} tone="warning">
                {w}
              </Alert>
            ))}
            {config.enabled && state.agents.length > 0 && (
              <ul
                aria-label="Carga dos agentes"
                className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft"
              >
                {state.agents.map((a) => (
                  <li key={a.key} className="flex items-center gap-3 px-3 py-2.5">
                    {face(a.key, 'md')}
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm">{a.name}</span>
                      <span
                        aria-hidden="true"
                        className="h-1 w-full max-w-40 rounded-full bg-muted"
                      >
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            a.limitProblem ? 'bg-warn' : 'bg-brand'
                          )}
                          style={{
                            width: `${Math.min(100, (a.active / Math.max(a.capacity, 1)) * 100)}%`
                          }}
                        />
                      </span>
                      {a.limitProblem && (
                        <span className="text-xs text-muted-foreground">{a.limitProblem}</span>
                      )}
                    </div>
                    <StatusToken
                      tone={a.limitProblem ? 'warning' : a.active > 0 ? 'running' : 'neutral'}
                      label={`${a.active} de ${a.capacity} em andamento`}
                    />
                  </li>
                ))}
              </ul>
            )}
            {config.enabled && status.waiting.length > 0 && (
              <ul
                aria-label="Esperando na última rodada"
                className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft"
              >
                {status.waiting.map((w) => (
                  <li key={w.taskId} className="flex flex-col px-3 py-2">
                    <span className="font-mono text-xs text-subtle-foreground">{w.displayId}</span>
                    <span className="text-xs text-muted-foreground">{w.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** O caminho em ordem (segue `next`), para desenhar como cadeia de chips. */
function orchestratorChain(config: OrchestratorConfig): { stageId: string; agents: string[] }[] {
  const out: { stageId: string; agents: string[] }[] = []
  const seen = new Set<string>()
  let lane: OrchestratorLane | undefined = config.lanes[0]
  let last: string | null = null
  while (lane && !seen.has(lane.stageId)) {
    seen.add(lane.stageId)
    out.push({ stageId: lane.stageId, agents: lane.agents })
    last = lane.next
    lane = config.lanes.find((l) => l.stageId === last)
  }
  if (last && !seen.has(last)) out.push({ stageId: last, agents: [] })
  return out
}

/** "Em andamento (Implementador) → Revisando (Revisor) → Revisado." */
export function orchestratorSummary(
  config: OrchestratorConfig,
  stageName: (id: string | null) => string,
  agentName: (key: string) => string
): string {
  const parts: string[] = []
  let lane: OrchestratorLane | undefined = config.lanes[0]
  const seen = new Set<string>()
  let last: string | null = null
  while (lane && !seen.has(lane.stageId)) {
    seen.add(lane.stageId)
    parts.push(`${stageName(lane.stageId)} (${lane.agents.map(agentName).join(', ')})`)
    last = lane.next
    lane = config.lanes.find((l) => l.stageId === lane!.next)
  }
  if (last && !seen.has(last)) parts.push(stageName(last))
  const rest = config.lanes.filter((l) => !seen.has(l.stageId))
  const extra =
    rest.length > 0
      ? ` Também: ${rest.map((l) => `${stageName(l.stageId)} (${l.agents.map(agentName).join(', ')})`).join('; ')}.`
      : ''
  return `${parts.join(' → ')}.${extra}`
}

export function OrchestratorEditor({
  draft,
  state,
  agents,
  busy,
  onChange,
  onCancel,
  onSave
}: {
  draft: OrchestratorConfig
  state: OrchestratorState
  agents: AgentsState
  busy: boolean
  onChange(d: OrchestratorConfig): void
  onCancel(): void
  onSave(d: OrchestratorConfig): void
}): React.JSX.Element {
  const set = (patch: Partial<OrchestratorConfig>): void => onChange({ ...draft, ...patch })
  const setLane = (i: number, patch: Partial<OrchestratorLane>): void =>
    set({ lanes: draft.lanes.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const usable = agents.agents.filter(isUsableAgent)
  const agentOptions = usable.map((a) => ({
    value: a.key,
    label: a.scope === 'builtin' ? `${a.profile.name} (embutido)` : a.profile.name
  }))
  const stageOptions = state.stages.map((s) => ({ value: s.id, label: s.name }))
  // A mesma validação do main (a checagem de permissão do agente vem do main, depois de salvar).
  const validation = useMemo(
    () =>
      validateOrchestrator(
        draft,
        state.stages,
        agents.agents.map((a) => ({
          key: a.key,
          name: a.profile?.name ?? a.id,
          status: a.status
        })),
        state.stagesWithFlow.map((stageId) => ({
          stageId,
          flowId: '',
          enabled: true,
          mode: 'on_enter' as const
        }))
      ),
    [draft, state, agents]
  )
  const freeStage = state.stages.find((s) => !draft.lanes.some((l) => l.stageId === s.id))

  return (
    <div role="form" aria-label="Configurar orquestrador" className="flex flex-col gap-4">
      <CheckboxField
        label="Ligar o orquestrador"
        description="Ligado, ele roda a cada ciclo das automações (cerca de 1 min) e logo depois de cada fluxo terminar."
        checked={draft.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Etapas de trabalho</h3>
        <p className="text-xs text-muted-foreground">
          Quando você move uma tarefa para uma delas, o menos ocupado dos agentes escolhidos pega a
          tarefa e o fluxo ligado à coluna roda com ele.
        </p>
        {draft.lanes.map((lane, i) => (
          <div
            key={i}
            role="group"
            aria-label={`Etapa de trabalho ${i + 1}`}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border-soft p-3"
          >
            <SelectField
              className="min-w-40 flex-1"
              label="Etapa"
              options={stageOptions}
              value={lane.stageId}
              onChange={(v) => setLane(i, { stageId: v })}
            />
            <MultiSelectField
              className="min-w-40 flex-1"
              label="Agentes"
              placeholder="Escolha os agentes"
              options={agentOptions}
              value={lane.agents}
              onChange={(value) => setLane(i, { agents: value })}
            />
            <SelectField
              className="min-w-40 flex-1"
              label="Quando o fluxo terminar bem"
              options={[
                { value: '', label: 'Fica na etapa' },
                ...state.stages
                  .filter((s) => s.id !== lane.stageId)
                  .map((s) => ({ value: s.id, label: `Mover para ${s.name}` }))
              ]}
              value={lane.next ?? ''}
              onChange={(v) => setLane(i, { next: v || null })}
            />
            <Button
              variant="danger"
              size="icon"
              aria-label={`Remover etapa de trabalho ${i + 1}`}
              onClick={() => set({ lanes: draft.lanes.filter((_, j) => j !== i) })}
            >
              <TrashIcon />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {freeStage && draft.lanes.length < ORCHESTRATOR_LIMITS.lanes && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                set({ lanes: [...draft.lanes, { stageId: freeStage.id, agents: [], next: null }] })
              }
            >
              <PlusIcon />
              Adicionar etapa de trabalho
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({ ...suggestOrchestrator(state.stages), enabled: draft.enabled })
            }
          >
            Usar sugestão
          </Button>
        </div>
      </div>

      {validation.errors.map((e) => (
        <Alert key={e} tone="danger">
          {e}
        </Alert>
      ))}
      {validation.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      <div className="flex gap-2">
        <Button disabled={busy || validation.errors.length > 0} onClick={() => onSave(draft)}>
          {busy && <Spinner />}
          Salvar orquestrador
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

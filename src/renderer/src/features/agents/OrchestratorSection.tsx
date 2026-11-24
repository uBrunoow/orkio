import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckboxField, SelectField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { Timestamp } from '@/components/Timestamp'
import { MultiSelectField } from './MultiSelectField'
import type { AgentsState } from '../../../../shared/agent'
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
import { StatusToken } from '../../components/StatusToken'
import { plural } from '../../lib/format'

/**
 * Orquestrador (8B) na tela Agentes: resumo em frase (fila → etapas → agentes), última rodada,
 * carga de cada agente e o que ficou esperando; o editor fica atrás de "Configurar".
 */
export function OrchestratorSection({
  projectId,
  agents
}: {
  projectId: string
  agents: AgentsState
}): React.JSX.Element {
  const [state, setState] = useState<OrchestratorState | null>(null)
  const [draft, setDraft] = useState<OrchestratorConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.orkio.agents.orchestrator(projectId).then((r) => {
        if (!alive) return
        if (r.ok) setState(r.value)
        else setError(r.error.message)
      })
    }
    load()
    const off = window.orkio.agents.onChanged((e) => {
      if (e.projectId === projectId) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [projectId, agents])

  if (!state) return <p className="text-xs text-muted-foreground">Carregando o orquestrador…</p>

  const stageName = (id: string | null): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    agents.agents.find((a) => a.key === key)?.profile?.name ?? key
  const { config, status } = state

  const run = async (): Promise<void> => {
    setBusy(true)
    const r = await window.orkio.agents.runOrchestrator(projectId)
    setBusy(false)
    if (r.ok) setState(r.value)
    else setError(r.error.message)
  }

  const save = async (next: OrchestratorConfig): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await window.orkio.agents.saveOrchestrator(projectId, next)
    setBusy(false)
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    setState(r.value)
    setDraft(null)
  }

  return (
    <section
      aria-label="Orquestrador"
      className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Orquestrador</h2>
        <StatusToken
          tone={!config.enabled ? 'neutral' : status.working > 0 ? 'running' : 'success'}
          label={
            !config.enabled
              ? 'Desligado'
              : status.working > 0
                ? `${plural(status.working, 'tarefa', 'tarefas')} em andamento`
                : 'Ligado'
          }
        />
        <div className="flex-1" />
        {config.enabled && !draft && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
            {busy && <Spinner />}
            Rodar agora
          </Button>
        )}
        {!draft && (
          <Button
            size="sm"
            variant="outline"
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
      <p className="text-xs text-muted-foreground">
        Você decide quando uma tarefa começa: mova para a primeira etapa de trabalho. Dali o
        orquestrador entrega a tarefa ao agente da etapa e passa para a seguinte quando o fluxo
        termina bem. Gates, push e falhas continuam parando em você.
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
        <p className="text-xs text-muted-foreground">
          Ainda não configurado. “Configurar orquestrador” sugere um caminho a partir das etapas do
          quadro e dos agentes embutidos.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p data-testid="orchestrator-summary">{summary(config, stageName, agentName)}</p>
          {config.enabled && (
            <p className="text-xs text-muted-foreground">
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
            <ul aria-label="Carga dos agentes" className="rounded-lg border border-border-soft">
              {state.agents.map((a) => (
                <li
                  key={a.key}
                  className="flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{a.name}</span>
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
              className="rounded-lg border border-border-soft"
            >
              {status.waiting.map((w) => (
                <li
                  key={w.taskId}
                  className="flex flex-col border-b border-border-soft px-3 py-2 last:border-b-0"
                >
                  <span className="font-mono text-xs text-subtle-foreground">{w.displayId}</span>
                  <span className="text-xs text-muted-foreground">{w.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/** "Em andamento (Implementador) → Revisando (Revisor) → Revisado." */
function summary(
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

function OrchestratorEditor({
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
  const usable = agents.agents.filter(
    (a) => a.profile && a.status !== 'invalid' && a.status !== 'archived'
  )
  const agentOptions = usable.map((a) => ({
    value: a.key,
    label: a.scope === 'builtin' ? `${a.profile!.name} (embutido)` : a.profile!.name
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
              variant="ghost"
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

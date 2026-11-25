import type { AgentsState } from '../../../../shared/agent'
import type { OrchestratorState } from '../../../../shared/orchestrator'
import { Button } from '@/components/ui/button'
import { StatusToken, type StatusTone } from '../../components/StatusToken'
import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Alert } from '../../components/Alert'
import { Spinner } from '../../components/Spinner'
import { Timestamp } from '../../components/Timestamp'
import { AgentsIcon, EditIcon, OrchestratorIcon, PowerIcon } from '../../components/icons'
import { ipcResult } from '../../lib/ipc'
import { suggestOrchestrator, type OrchestratorConfig } from '../../../../shared/orchestrator'
import { AgentCrumbs, Chip, SetupRow, Stat } from './AgentDetail'
import { useOrchestrator } from './useAgents'
import { AgentAvatar } from './AgentAvatar'
import { plural } from '../../lib/format'
import { OrchestratorEditor, orchestratorSummary } from './OrchestratorSection'

/** Rosto do orquestrador: o mesmo desenho dos agentes, com semente e cor fixas. */
export function OrchestratorFace({ size }: { size: 'md' | 'lg' | 'xl' }): React.JSX.Element {
  return <AgentAvatar name="Orquestrador" color="yellow" seed="orkio:orchestrator" size={size} />
}

function orchestratorNow(state: OrchestratorState | null): { tone: StatusTone; label: string } {
  if (!state) return { tone: 'neutral', label: 'Carregando…' }
  const { config, status } = state
  if (!config.enabled) return { tone: 'neutral', label: 'Desligado' }
  if (status.error) return { tone: 'warning', label: 'Última rodada não aconteceu' }
  if (status.working > 0)
    return { tone: 'running', label: `${plural(status.working, 'tarefa', 'tarefas')} com agente` }
  return { tone: 'success', label: 'Ligado, esperando tarefas' }
}

function pathText(state: OrchestratorState | null, agents: AgentsState): string {
  if (!state || state.config.lanes.length === 0)
    return 'Passa cada tarefa para a próxima etapa quando o fluxo termina.'
  const stageName = (id: string | null): string =>
    state.stages.find((s) => s.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    agents.agents.find((a) => a.key === key)?.profile?.name ?? key
  return orchestratorSummary(state.config, stageName, agentName)
}

/** Vagas somadas dos agentes que o orquestrador usa ("2/5 vagas"). */
function capacityText(state: OrchestratorState | null): string | null {
  if (!state?.config.enabled || state.agents.length === 0) return null
  const active = state.agents.reduce((n, a) => n + a.active, 0)
  const capacity = state.agents.reduce((n, a) => n + a.capacity, 0)
  return `${active}/${capacity} ${capacity === 1 ? 'vaga' : 'vagas'}`
}

const TAG = 'rounded-full border border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground'

/** O orquestrador na lista de Agentes, no formato do card dos agentes; abre a página dele. */
export function OrchestratorCard({
  state,
  agents,
  onOpen
}: {
  state: OrchestratorState | null
  agents: AgentsState
  onOpen(): void
}): React.JSX.Element {
  const now = orchestratorNow(state)
  const capacity = capacityText(state)
  const waiting = state?.config.enabled ? (state.status.waiting.length ?? 0) : 0
  return (
    <div
      role="listitem"
      aria-label="Orquestrador"
      data-testid="orchestrator-card"
      className="relative flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-3.5 hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-start gap-3">
        <OrchestratorFace size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <button
            type="button"
            onClick={onOpen}
            aria-label="Abrir Orquestrador"
            className="truncate rounded-sm text-left font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
          >
            Orquestrador
          </button>
          <p className="line-clamp-2 text-xs text-muted-foreground">{pathText(state, agents)}</p>
        </div>
      </div>
      <StatusToken {...now} className="text-sm" />
      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-2.5">
        <span className={TAG}>Do projeto</span>
        {waiting > 0 && <span className={TAG}>{`${waiting} esperando`}</span>}
        {capacity && (
          <span className="tabular ml-auto text-2xs text-subtle-foreground">{capacity}</span>
        )}
      </div>
    </div>
  )
}

/** O orquestrador na visualização em linhas (mesmo formato da linha dos agentes). */
export function OrchestratorRow({
  state,
  agents,
  onOpen
}: {
  state: OrchestratorState | null
  agents: AgentsState
  onOpen(): void
}): React.JSX.Element {
  const now = orchestratorNow(state)
  return (
    <li
      aria-label="Orquestrador"
      data-testid="orchestrator-card"
      className="relative flex items-start gap-3 border-b border-border-soft px-4 py-3 last:border-b-0 hover:bg-muted/40"
    >
      <OrchestratorFace size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <button
            type="button"
            onClick={onOpen}
            aria-label="Abrir Orquestrador"
            className="truncate rounded-sm text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/40 focus-visible:after:ring-inset"
          >
            Orquestrador
          </button>
          <span className="text-xs text-muted-foreground">Do projeto</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{pathText(state, agents)}</p>
        <StatusToken {...now} />
      </div>
    </li>
  )
}

/**
 * Página do orquestrador (pela lista), no formato da página de um agente: cabeçalho, "Como tem
 * ido" (rodada, carga dos agentes, o que ficou esperando) e a configuração em linhas (ligado,
 * caminho e cada etapa). "Configurar orquestrador" abre o editor de sempre no lugar das colunas.
 */
export function OrchestratorDetail({
  projectId,
  agents,
  onBack
}: {
  projectId: string
  agents: AgentsState
  onBack(): void
}): React.JSX.Element {
  const orchestrator = useOrchestrator(projectId)
  const state = orchestrator.value
  const [draft, setDraft] = useState<OrchestratorConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setError] = useState<string | null>(null)
  const error = actionError ?? orchestrator.error?.message ?? null
  const now = orchestratorNow(state)

  const save = async (next: OrchestratorConfig): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const r = await ipcResult(() => window.orkio.agents.saveOrchestrator(projectId, next))
    setBusy(false)
    if (!r.ok) {
      setError(r.error.message)
      return false
    }
    orchestrator.set(r.value)
    return true
  }
  const run = async (): Promise<void> => {
    setBusy(true)
    const r = await ipcResult(() => window.orkio.agents.runOrchestrator(projectId))
    setBusy(false)
    if (r.ok) orchestrator.set(r.value)
    else setError(r.error.message)
  }
  const configure = (): void => {
    if (!state) return
    setError(null)
    setDraft(
      state.config.lanes.length === 0 && !state.config.enabled
        ? suggestOrchestrator(state.stages)
        : structuredClone(state.config)
    )
  }

  const stageName = (id: string | null): string =>
    state?.stages.find((st) => st.id === id)?.name ?? 'etapa removida'
  const agentName = (key: string): string =>
    agents.agents.find((a) => a.key === key)?.profile?.name ?? key

  return (
    <div role="region" aria-label="Agente Orquestrador" className="flex flex-col gap-6">
      <AgentCrumbs name="Orquestrador" onBack={onBack} />
      <header className="flex flex-wrap items-start gap-5">
        <OrchestratorFace size="xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-medium text-foreground">Orquestrador</h2>
            <Chip>Coordenador</Chip>
            <Chip mono>Do projeto</Chip>
          </div>
          <p className="text-sm text-muted-foreground">
            Entrega cada tarefa ao agente da etapa e passa para a seguinte quando o fluxo termina
            bem. Quem começa a tarefa é você; gates, push e falhas continuam parando em você.
          </p>
          <StatusToken {...now} />
        </div>
        {state && !draft && (
          <div className="flex flex-wrap gap-2">
            {state.config.enabled && (
              <Button variant="outline" disabled={busy} onClick={() => void run()}>
                {busy && <Spinner />}
                Rodar agora
              </Button>
            )}
            <Button variant="outline" onClick={configure}>
              <EditIcon />
              Configurar orquestrador
            </Button>
          </div>
        )}
      </header>

      {error && <Alert tone="danger">{error}</Alert>}

      {!state ? (
        <p className="text-xs text-muted-foreground">Carregando o orquestrador…</p>
      ) : draft ? (
        <section
          aria-label="Orquestrador"
          className="flex flex-col gap-3 rounded-xl border border-border-soft bg-card p-4"
        >
          <OrchestratorEditor
            draft={draft}
            state={state}
            agents={agents}
            busy={busy}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={(d) =>
              void save(d).then((ok) => {
                if (ok) setDraft(null)
              })
            }
          />
        </section>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="orch-going" className="flex flex-col gap-2.5">
            <h3 id="orch-going" className="px-0.5 text-sm font-medium text-foreground">
              Como tem ido
            </h3>
            <div className="flex flex-col gap-5 rounded-xl border border-border-soft bg-card p-5">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Tarefas com agente" value={String(state.status.working)} />
                <Stat label="Na última rodada" value={String(state.status.lastActions)} />
                <Stat label="Esperando" value={String(state.status.waiting.length)} />
                <Stat label="Vagas" value={capacityText(state)?.split(' ')[0] ?? '—'} />
              </dl>
              <p className="text-xs text-muted-foreground">
                {!state.config.enabled ? (
                  'Desligado: nenhuma tarefa anda sozinha.'
                ) : state.status.lastRunAt ? (
                  <>
                    Última rodada <Timestamp value={state.status.lastRunAt} />
                  </>
                ) : (
                  'Primeira rodada no próximo ciclo (até 1 min).'
                )}
              </p>
              {state.status.error && <Alert tone="warning">{state.status.error}</Alert>}
              {state.validation.warnings.map((w) => (
                <Alert key={w} tone="warning">
                  {w}
                </Alert>
              ))}

              {state.config.enabled && state.agents.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
                  <p className="text-xs text-muted-foreground">Carga dos agentes</p>
                  <ul aria-label="Carga dos agentes" className="flex flex-col gap-2">
                    {state.agents.map((a) => {
                      const view = agents.agents.find((v) => v.key === a.key)
                      return (
                        <li key={a.key} className="flex items-center gap-3">
                          <AgentAvatar
                            name={a.name}
                            color={view?.profile?.color ?? 'yellow'}
                            seed={a.key}
                            size="sm"
                          />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm">{a.name}</span>
                            {a.limitProblem && (
                              <span className="text-xs text-muted-foreground">
                                {a.limitProblem}
                              </span>
                            )}
                          </div>
                          <StatusToken
                            tone={a.limitProblem ? 'warning' : a.active > 0 ? 'running' : 'neutral'}
                            label={`${a.active} de ${a.capacity} em andamento`}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
                <p className="text-xs text-muted-foreground">Esperando na última rodada</p>
                {state.status.waiting.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nada esperando.</p>
                ) : (
                  <ul aria-label="Esperando na última rodada" className="flex flex-col gap-1.5">
                    {state.status.waiting.map((w) => (
                      <li key={w.taskId} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-subtle-foreground">
                          {w.displayId}
                        </span>
                        <span className="text-xs text-muted-foreground">{w.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section aria-labelledby="orch-setup" className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5 px-0.5">
              <h3 id="orch-setup" className="text-sm font-medium text-foreground">
                Configuração
              </h3>
              <p className="text-xs text-muted-foreground">Vale para este projeto.</p>
            </div>
            <div className="flex flex-col divide-y divide-border-soft rounded-xl border border-border-soft bg-card">
              <div className="flex items-center gap-3 px-4 py-3">
                <PowerIcon className="size-4 shrink-0 text-muted-foreground" />
                <label htmlFor="orch-enabled" className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm text-foreground">Ligado</span>
                  <span className="text-xs text-muted-foreground">
                    {state.config.enabled
                      ? 'Passa as tarefas adiante sozinho.'
                      : state.config.lanes.length === 0
                        ? 'Configure o caminho antes de ligar.'
                        : 'Nada anda sozinho.'}
                  </span>
                </label>
                <Switch
                  id="orch-enabled"
                  checked={state.config.enabled}
                  disabled={busy || state.config.lanes.length === 0}
                  onCheckedChange={(enabled) => void save({ ...state.config, enabled })}
                />
              </div>
              <SetupRow
                icon={OrchestratorIcon}
                title="Caminho"
                summary={
                  state.config.lanes.length === 0
                    ? 'Ainda não configurado: a sugestão monta pelas etapas do quadro.'
                    : orchestratorSummary(state.config, stageName, agentName)
                }
                onOpen={configure}
              />
              {state.config.lanes.map((l) => (
                <SetupRow
                  key={l.stageId}
                  icon={AgentsIcon}
                  title={stageName(l.stageId)}
                  summary={`${l.agents.map(agentName).join(', ') || 'Nenhum agente'}${l.next ? ` → ${stageName(l.next)}` : ' · fica na etapa'}`}
                  onOpen={configure}
                />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

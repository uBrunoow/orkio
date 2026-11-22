import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { MultiSelector } from '@astryxdesign/core/MultiSelector'
import { Selector } from '@astryxdesign/core/Selector'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { VStack } from '@astryxdesign/core/VStack'
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

  if (!state) return <Text type="supporting">Carregando o orquestrador…</Text>

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
    <Card role="region" aria-label="Orquestrador">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Heading level={2}>Orquestrador</Heading>
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
          <StackItem size="fill" />
          {config.enabled && !draft && (
            <Button
              size="sm"
              variant="secondary"
              label="Rodar agora"
              isLoading={busy}
              onClick={() => void run()}
            />
          )}
          {!draft && (
            <Button
              size="sm"
              variant="secondary"
              label="Configurar orquestrador"
              onClick={() => {
                setError(null)
                setDraft(
                  config.lanes.length === 0 && !config.enabled
                    ? suggestOrchestrator(state.stages)
                    : structuredClone(config)
                )
              }}
            />
          )}
        </HStack>
        <Text type="supporting">
          Puxa tarefas da fila para os agentes, por prioridade do Notion, e passa cada uma para a
          etapa seguinte quando o fluxo da etapa termina bem. Gates, push e falhas continuam parando
          em você.
        </Text>
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
          <Text type="supporting" color="secondary">
            Ainda não configurado. “Configurar orquestrador” sugere um caminho a partir das etapas
            do quadro e dos agentes embutidos.
          </Text>
        ) : (
          <VStack gap={3}>
            <Text data-testid="orchestrator-summary">{summary(config, stageName, agentName)}</Text>
            {config.enabled && (
              <Text type="supporting" color="secondary">
                {status.lastRunAt ? (
                  <>
                    Última rodada <Timestamp value={status.lastRunAt} format="auto" />
                  </>
                ) : (
                  'Primeira rodada no próximo ciclo (até 1 min)'
                )}
                {` · ${plural(status.queued, 'tarefa', 'tarefas')} na fila · até ${config.maxActive} ao mesmo tempo`}
              </Text>
            )}
            {status.error && <Alert tone="warning">{status.error}</Alert>}
            {state.validation.warnings.map((w) => (
              <Alert key={w} tone="warning">
                {w}
              </Alert>
            ))}
            {config.enabled && state.agents.length > 0 && (
              <List hasDividers density="compact" aria-label="Carga dos agentes">
                {state.agents.map((a) => (
                  <Item
                    as="li"
                    key={a.key}
                    label={a.name}
                    description={a.limitProblem ?? undefined}
                    endContent={
                      <StatusToken
                        tone={a.limitProblem ? 'warning' : a.active > 0 ? 'running' : 'neutral'}
                        label={`${a.active} de ${a.capacity} em andamento`}
                      />
                    }
                  />
                ))}
              </List>
            )}
            {config.enabled && status.waiting.length > 0 && (
              <List hasDividers density="compact" aria-label="Esperando na última rodada">
                {status.waiting.map((w) => (
                  <Item as="li" key={w.taskId} label={w.displayId} description={w.reason} />
                ))}
              </List>
            )}
          </VStack>
        )}
      </VStack>
    </Card>
  )
}

/** "Puxa de Prioridades → Em andamento (Implementador) → Revisando (Revisor) → Revisado." */
function summary(
  config: OrchestratorConfig,
  stageName: (id: string | null) => string,
  agentName: (key: string) => string
): string {
  const parts = [`Puxa de ${stageName(config.queueStageId)}`]
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
  const freeStage = state.stages.find(
    (s) => s.id !== draft.queueStageId && !draft.lanes.some((l) => l.stageId === s.id)
  )

  return (
    <VStack gap={4} role="form" aria-label="Configurar orquestrador">
      <CheckboxInput
        label="Ligar o orquestrador"
        description="Ligado, ele roda a cada ciclo das automações (cerca de 1 min) e logo depois de cada fluxo terminar."
        value={draft.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      <HStack gap={3} wrap="wrap">
        <StackItem size="fill">
          <Selector
            label="Puxar tarefas de"
            placeholder="Escolha a coluna de fila"
            options={stageOptions}
            {...(draft.queueStageId ? { value: draft.queueStageId } : {})}
            onChange={(v: string) => set({ queueStageId: v })}
          />
        </StackItem>
        <StackItem size="fill">
          <Selector
            label="Tarefas ao mesmo tempo"
            description="Só limita o puxar da fila; o que já está em andamento segue."
            options={Array.from({ length: ORCHESTRATOR_LIMITS.maxActive }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1)
            }))}
            value={String(draft.maxActive)}
            onChange={(v: string) => set({ maxActive: Number(v) })}
          />
        </StackItem>
      </HStack>

      <VStack gap={2}>
        <Heading level={3}>Etapas de trabalho</Heading>
        <Text type="supporting">
          A primeira recebe as tarefas puxadas da fila. Em cada etapa, o menos ocupado dos agentes
          escolhidos pega a tarefa e o fluxo ligado à coluna roda com ele.
        </Text>
        {draft.lanes.map((lane, i) => (
          <HStack
            key={i}
            gap={2}
            vAlign="end"
            wrap="wrap"
            role="group"
            aria-label={`Etapa de trabalho ${i + 1}`}
          >
            <StackItem size="fill">
              <Selector
                label="Etapa"
                options={stageOptions}
                value={lane.stageId}
                onChange={(v: string) => setLane(i, { stageId: v })}
              />
            </StackItem>
            <StackItem size="fill">
              <MultiSelector
                label="Agentes"
                placeholder="Escolha os agentes"
                options={agentOptions}
                value={lane.agents}
                triggerDisplay="labels"
                onChange={(value: string[]) => setLane(i, { agents: value })}
              />
            </StackItem>
            <StackItem size="fill">
              <Selector
                label="Quando o fluxo terminar bem"
                options={[
                  { value: '', label: 'Fica na etapa' },
                  ...state.stages
                    .filter((s) => s.id !== lane.stageId)
                    .map((s) => ({ value: s.id, label: `Mover para ${s.name}` }))
                ]}
                value={lane.next ?? ''}
                onChange={(v: string) => setLane(i, { next: v || null })}
              />
            </StackItem>
            <Button
              variant="ghost"
              isIconOnly
              label={`Remover etapa de trabalho ${i + 1}`}
              icon={<Icon icon={TrashIcon} />}
              onClick={() => set({ lanes: draft.lanes.filter((_, j) => j !== i) })}
            />
          </HStack>
        ))}
        <HStack gap={2} wrap="wrap">
          {freeStage && draft.lanes.length < ORCHESTRATOR_LIMITS.lanes && (
            <Button
              size="sm"
              variant="secondary"
              label="Adicionar etapa de trabalho"
              icon={<Icon icon={PlusIcon} />}
              onClick={() =>
                set({ lanes: [...draft.lanes, { stageId: freeStage.id, agents: [], next: null }] })
              }
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            label="Usar sugestão"
            onClick={() =>
              onChange({ ...suggestOrchestrator(state.stages), enabled: draft.enabled })
            }
          />
        </HStack>
      </VStack>

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
      <HStack gap={2}>
        <Button
          variant="primary"
          label="Salvar orquestrador"
          isLoading={busy}
          isDisabled={validation.errors.length > 0}
          onClick={() => onSave(draft)}
        />
        <Button variant="ghost" label="Cancelar" onClick={onCancel} />
      </HStack>
    </VStack>
  )
}

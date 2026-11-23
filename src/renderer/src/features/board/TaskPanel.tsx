import { ScreenTitle } from '../../components/ScreenTitle'
import { useEffect, useMemo, useState } from 'react'
import { Divider } from '@astryxdesign/core/Divider'
import { HStack } from '@astryxdesign/core/HStack'
import { ScrollableArea } from '@astryxdesign/core/ScrollableArea'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardStage,
  TaskSignals
} from '../../../../shared/ipc-contract'
import type { TaskSection } from '../../../../shared/overview'
import type { FlowRunView } from '../../../../shared/task-flow'
import type { AgentBadge } from '../../../../shared/agent'
import { useTaskRuns } from '../claude/useTaskRuns'
import { TaskFlowSection, type TaskActivity } from '../task-flows/TaskFlowSection'
import { flowPlan, flowStepIndex } from '../task-flows/flow-plan'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { availableTabs, defaultPanelTab, PANEL_TAB_LABEL, type PanelTab } from '../task/panel-tab'
import { taskLayout } from '../task/task-layout'
import { taskPhases } from '../task/task-phases'
import { TaskPhaseBar } from '../task/TaskPhaseBar'
import { ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { useWindowWidth } from '../task/useWindowWidth'
import { StageSelector, TaskChanges, TaskDetails, useBacklogSummary } from './TaskDetails'
import { TaskSession } from './TaskSession'

/**
 * Aba inativa: fica montada (o fluxo e os pedidos continuam vivos fora da aba), mas escondida.
 * O `hidden` sozinho perde para o `display: flex` da pilha; o estilo inline (CSSOM) não fere a CSP.
 */
const HIDDEN = { display: 'none' } as const

/**
 * Tarefa como sessão: no topo, em que pé está (marcos) e o que espera você; no centro, a conversa
 * (eventos, execuções do Claude Code, fluxo) com o campo de mensagem; ao lado (ou nas abas do
 * painel), o estado: mudanças, GitHub, documentos, agente e opções.
 * `panel` = prévia ao lado do Quadro (abas, rolagem própria, "Abrir tarefa"); `page` = tela cheia
 * em duas colunas (sessão à esquerda, estado à direita).
 */
export function TaskPanel({
  projectId,
  agent,
  card,
  stages,
  signals,
  onMove,
  onToggleBlocked,
  onToggleAutomation,
  onBranchesChanged,
  focusSection = null,
  projectName = null
}: {
  projectId: string
  /** Agente da tarefa (8A). */
  agent: AgentBadge | null
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  onMove(stageId: string): void
  onToggleBlocked(blocked: boolean): void
  onToggleAutomation(paused: boolean): void
  /** Vinculou/desvinculou uma branch (Detalhes > GitHub): relê os sinais. */
  onBranchesChanged?: () => void
  /** Seção a mostrar ao abrir (Visão geral, 6D): Fluxo, Claude Code ou Histórico. */
  focusSection?: TaskSection | null
  /** Projeto no caminho da barra ("orkio › ORK-142 · título"). */
  projectName?: string | null
}): React.JSX.Element {
  // Aba escolhida pela pessoa; até lá, a aba da fase atual (`defaultPanelTab`).
  const [chosenTab, setTab] = useState<PanelTab | null>(
    focusSection === 'history' ? 'details' : null
  )
  const layout = taskLayout(useWindowWidth())
  // Vindo do sino ou de uma notificação: rola até a seção certa quando a tarefa abre.
  useEffect(() => {
    if (!focusSection) return
    const timer = setTimeout(() => {
      if (focusSection === 'history') setTab('details')
      document
        .querySelector(`[data-panel-section="${focusSection}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(timer)
  }, [focusSection, card.taskId])

  const runs = useTaskRuns(projectId, card.taskId)
  const [history, setHistory] = useState<BoardHistoryEntry[] | null>(null)
  const [flowLive, setFlowLive] = useState(false)
  const [focusRun, setFocusRun] = useState<{ runId: string; nonce: number } | null>(null)
  // Execuções do fluxo: cada turno do Claude Code disparado por um passo mostra de onde veio.
  const [flowRuns, setFlowRuns] = useState<readonly FlowRunView[]>([])
  const flowOrigins = useMemo(() => flowStepIndex(flowRuns), [flowRuns])
  // Execuções e fluxos também escrevem no histórico (início, fim, bloqueios, passos).
  const [tick, setTick] = useState(0)
  useEffect(
    () =>
      window.orkio.claude.onRunEvent((m) => {
        if (
          m.taskId === card.taskId &&
          (m.event.kind === 'status' ||
            (m.event.kind === 'permission' && m.event.state === 'blocked'))
        ) {
          setTick((n) => n + 1)
        }
      }),
    [card.taskId]
  )
  useEffect(
    () =>
      window.orkio.taskFlows.onChanged((e) => {
        if (e.taskId === card.taskId) setTick((n) => n + 1)
      }),
    [card.taskId]
  )
  const stageName = (id: string | null): string =>
    id ? (stages.find((s) => s.id === id)?.name ?? 'etapa removida') : 'Sem etapa'

  // Recarrega o histórico quando o card muda (movido, sincronizado, recusado).
  useEffect(() => {
    let active = true
    void window.orkio.board
      .history(projectId, card.taskId)
      .then((result) => {
        if (active) setHistory(result.ok ? result.value : [])
      })
      .catch(() => {
        if (active) setHistory([])
      })
    return () => {
      active = false
    }
  }, [
    projectId,
    card.taskId,
    card.stageId,
    card.blocked,
    card.automationPaused,
    card.sync.state,
    agent?.key,
    tick
  ])
  const backlog = useBacklogSummary(projectId, card.taskId, tick)

  // Quem está trabalhando agora: o passo do fluxo; senão a execução avulsa do Claude Code.
  const [flowActivity, setFlowActivity] = useState<TaskActivity | null>(null)
  const state = runs.state
  const activeRun = state?.runs.find((r) => r.id === state.activeRunId) ?? null
  const runActivity: TaskActivity | null =
    activeRun?.status === 'running'
      ? {
          who: agent && activeRun.agentKey === agent.key ? agent.name : 'Claude Code',
          what: activeRun.command ? `/${activeRun.command}` : null,
          since: activeRun.startedAt
        }
      : null
  const activity = flowActivity ?? runActivity

  const label = card.displayId ?? card.title

  const flowSlot = (
    <VStack data-panel-section="flow">
      <TaskFlowSection
        projectId={projectId}
        taskId={card.taskId}
        stageId={card.stageId}
        pr={signals?.pr ?? null}
        onActivityChange={setFlowActivity}
        onWaitingChange={() => undefined}
        onOpenRun={(runId) => setFocusRun({ runId, nonce: Date.now() })}
        onLiveChange={setFlowLive}
        onRunsChange={setFlowRuns}
      />
    </VStack>
  )

  const session = (
    <VStack data-panel-section="claude" height="100%">
      <TaskSession
        projectId={projectId}
        taskId={card.taskId}
        agent={agent}
        history={history}
        stageName={stageName}
        runs={runs}
        flowSlot={flowSlot}
        flowRunning={flowLive && flowActivity !== null}
        activity={activity}
        scrollToEnd={!focusSection}
        focusRun={focusRun}
        backlogLinked={!!backlog?.linked}
        flowOrigins={flowOrigins}
      />
    </VStack>
  )
  const changes = (
    <TaskChanges
      projectId={projectId}
      taskId={card.taskId}
      stageName={card.stageId ? stageName(card.stageId) : null}
      runs={runs}
    />
  )
  const details = (
    showStage: boolean,
    changesSlot: React.ReactNode = null,
    part: 'all' | 'pr' | 'details' = 'all'
  ) => (
    <TaskDetails
      part={part}
      changes={changesSlot}
      projectId={projectId}
      card={card}
      stages={stages}
      signals={signals}
      agent={agent}
      backlog={backlog}
      history={history}
      stageName={stageName}
      onMove={onMove}
      onToggleBlocked={onToggleBlocked}
      onToggleAutomation={onToggleAutomation}
      {...(onBranchesChanged ? { onBranchesChanged } : {})}
      showStage={showStage}
    />
  )

  const hasBacklogDoc = !!backlog?.task
  const tabs = availableTabs(hasBacklogDoc)
  const phases = taskPhases({
    plan: flowRuns[0] ? flowPlan(flowRuns[0]) : null,
    stages,
    stageId: card.stageId
  })
  const currentPhase =
    phases.find((p) => p.state === 'waiting' || p.state === 'current' || p.state === 'failed')
      ?.label ?? null
  const suggested = defaultPanelTab({
    currentPhase,
    hasBacklogDoc,
    hasDiff: (state?.workspace?.changes ?? 0) > 0 || (state?.runs.length ?? 0) > 0,
    hasPr: !!signals?.pr
  })
  const tab = chosenTab && tabs.includes(chosenTab) ? chosenTab : suggested
  const tabContent: Record<PanelTab, React.ReactNode> = {
    spec: (
      <BacklogDocumentView
        projectId={projectId}
        taskId={card.taskId}
        refreshKey={tick}
        part="spec"
      />
    ),
    plan: (
      <BacklogDocumentView
        projectId={projectId}
        taskId={card.taskId}
        refreshKey={tick}
        part="plan"
      />
    ),
    changes,
    pr: details(false, null, 'pr'),
    details: details(false, null, 'details')
  }

  const sidePanel = (
    <VStack role="complementary" aria-label={`Detalhes de ${label}`} height="100%">
      <TabList
        value={tab}
        onChange={(v) => setTab(tabs.find((t) => t === v) ?? suggested)}
        role="tablist"
        size="sm"
        hasDivider
      >
        {tabs.map((t) => (
          <Tab
            key={t}
            value={t}
            label={PANEL_TAB_LABEL[t]}
            panelId={`task-tab-${t}-${card.taskId}`}
          />
        ))}
      </TabList>
      <StackItem size="fill">
        <ScrollableArea label={`Detalhes de ${label} (rolagem)`} height="100%" padding={4}>
          {tabs.map((t) => (
            <VStack
              key={t}
              role="tabpanel"
              id={`task-tab-${t}-${card.taskId}`}
              aria-label={PANEL_TAB_LABEL[t]}
              hidden={tab !== t}
              {...(tab !== t ? { style: HIDDEN } : {})}
            >
              {tabContent[t]}
            </VStack>
          ))}
        </ScrollableArea>
      </StackItem>
    </VStack>
  )

  const branch = signals?.localBranches[0] ?? signals?.remoteBranches[0] ?? null

  return (
    <VStack role="region" aria-label={`Tarefa ${label}`} height="100%">
      <ScreenBarStart>
        <HStack gap={2} vAlign="center">
          {projectName && (
            <Text type="supporting" color="secondary">
              {`${projectName} ›`}
            </Text>
          )}
          {card.displayId && (
            <Text type="supporting" color="secondary" className="orkio-mono">
              {`${card.displayId} ·`}
            </Text>
          )}
          <ScreenTitle look={5} maxLines={1}>
            {card.title}
          </ScreenTitle>
          {branch && (
            <Text type="supporting" color="secondary" className="orkio-mono" maxLines={1}>
              {branch}
            </Text>
          )}
        </HStack>
      </ScreenBarStart>
      <ScreenBarEnd>
        <TaskPhaseBar phases={phases} />
        <StageSelector card={card} stages={stages} onMove={onMove} compact />
      </ScreenBarEnd>
      {layout === 'columns' ? (
        <HStack vAlign="stretch" height="100%">
          <StackItem size="fill">{session}</StackItem>
          <Divider orientation="vertical" />
          <VStack width="calc(var(--spacing-12) * 9)" height="100%">
            {sidePanel}
          </VStack>
        </HStack>
      ) : (
        <VStack height="100%">
          <VStack height="calc(var(--spacing-12) * 5)">{sidePanel}</VStack>
          <Divider />
          <StackItem size="fill">{session}</StackItem>
        </VStack>
      )}
    </VStack>
  )
}

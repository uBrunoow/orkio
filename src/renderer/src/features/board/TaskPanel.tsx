import { useEffect, useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScreenTitle } from '../../components/ScreenTitle'
import type { TaskSection } from '../../../../shared/overview'
import type { FlowRunView } from '../../../../shared/task-flow'
import type { AgentBadge } from '../../../../shared/agent'
import { useTaskRuns } from '../claude/useTaskRuns'
import { TaskFlowSection, type TaskActivity } from '../task-flows/TaskFlowSection'
import { FlowPlanPanel } from '../task-flows/FlowPlanPanel'
import { flowPlan, flowStepIndex } from '../task-flows/flow-plan'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { ReviewPanel } from '../task/ReviewPanel'
import { availableTabs, defaultPanelTab, PANEL_TAB_LABEL, type PanelTab } from '../task/panel-tab'
import { compactPhaseBar, taskLayout } from '../task/task-layout'
import { taskPhases } from '../task/task-phases'
import { TaskPhaseBar } from '../task/TaskPhaseBar'
import { CrumbLink, ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { useWindowWidth } from '../task/useWindowWidth'
import { StageSelector, TaskChanges, TaskDetails, useBacklogSummary } from './TaskDetails'
import { OpenPrButton, canOpenPr } from './OpenPrButton'
import { EnvironmentPanel } from '../task/EnvironmentPanel'
import { TaskSession } from './TaskSession'
import type { BoardCard, BoardHistoryEntry, BoardStage } from '../../../../shared/board'
import type { TaskSignals } from '../../../../shared/task-signals'
import { isLive } from '../../../../shared/flow-run-state'

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
  projectName = null,
  onOpenBoard
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
  /** Clique no projeto do caminho: volta ao quadro. */
  onOpenBoard?: () => void
}): React.JSX.Element {
  // Aba escolhida pela pessoa; até lá, a aba da fase atual (`defaultPanelTab`).
  const [chosenTab, setTab] = useState<PanelTab | null>(
    focusSection === 'history' ? 'details' : null
  )
  const windowWidth = useWindowWidth()
  const layout = taskLayout(windowWidth)
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
  const [planOpen, setPlanOpen] = useState(false)
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
            // Pergunta do Claude (ex.: "Aprova a spec?"): relê a spec/plano para aprovar vendo.
            m.event.kind === 'question' ||
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
    <div data-panel-section="flow" className="flex flex-col">
      <TaskFlowSection
        projectId={projectId}
        taskId={card.taskId}
        stageId={card.stageId}
        pr={signals?.pr ?? null}
        onActivityChange={setFlowActivity}
        onOpenRun={(runId) => setFocusRun({ runId, nonce: Date.now() })}
        onLiveChange={setFlowLive}
        onRunsChange={setFlowRuns}
        onShowPlan={() => setPlanOpen(true)}
      />
    </div>
  )

  const session = (
    <div data-panel-section="claude" className="flex h-full min-h-0 flex-col">
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
        canOpenPr={canOpenPr(signals?.pr) && !!state?.workspace}
      />
    </div>
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
  const tabs = availableTabs(hasBacklogDoc, !!signals?.pr)
  const phases = taskPhases({
    plan: flowRuns[0] ? flowPlan(flowRuns[0]) : null,
    stages,
    stageId: card.stageId
  })
  const liveRun = flowRuns[0] && isLive(flowRuns[0].status) ? flowRuns[0] : null
  const flowActive = flowRuns.some((r) => isLive(r.status))
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
    pr: (
      <div className="flex flex-col gap-6">
        {/* Sem PR aberta e com ambiente: "commits à frente" não é lido aqui (o push recusa se não
            houver nada novo). */}
        {canOpenPr(signals?.pr) && state?.workspace && (
          <OpenPrButton projectId={projectId} taskId={card.taskId} flowActive={flowActive} />
        )}
        {details(false, null, 'pr')}
      </div>
    ),
    review: (
      <ReviewPanel
        projectId={projectId}
        taskId={card.taskId}
        active={tab === 'review'}
        refreshKey={tick}
      />
    ),
    details: (
      <div className="flex flex-col gap-5">
        <EnvironmentPanel
          projectId={projectId}
          taskId={card.taskId}
          projectName={projectName}
          workspace={state?.workspace ?? null}
          latestRun={state?.runs[0] ?? null}
          signals={signals}
          flowActive={flowActive}
          refreshKey={tick}
        />
        {details(false, null, 'details')}
      </div>
    )
  }

  const sidePanel = (
    <aside aria-label={`Detalhes de ${label}`} className="flex h-full min-h-0 flex-col bg-surface">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(tabs.find((t) => t === v) ?? suggested)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList
          variant="line"
          className="h-[42px] w-full shrink-0 items-end justify-start gap-4 rounded-none border-b border-border-soft px-[18px] py-0 group-data-[orientation=horizontal]/tabs:h-[42px]"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="h-full flex-none items-end rounded-none px-0 pt-0 pb-2.5 text-[12.5px] font-normal text-subtle-foreground after:bg-brand group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] hover:text-foreground data-[state=active]:text-foreground"
            >
              {PANEL_TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
          {tabs.map((t) => (
            // Aba inativa: fica montada (o fluxo e os pedidos continuam vivos fora da aba), mas
            // escondida.
            <TabsContent
              key={t}
              value={t}
              forceMount
              className="flex flex-col data-[state=inactive]:hidden"
            >
              {tabContent[t]}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </aside>
  )

  const branch = signals?.localBranches[0] ?? signals?.remoteBranches[0] ?? null

  return (
    <section aria-label={`Tarefa ${label}`} className="flex h-full min-h-0 flex-col">
      <ScreenBarStart>
        <div className="flex min-w-0 items-center gap-3">
          {/* Sem min-w-0: o título não encolhe abaixo do mínimo dele (sobreporia a branch). */}
          <div className="flex items-center gap-1 text-sm">
            {projectName && (
              <span className="shrink-0 text-muted-foreground">
                <CrumbLink label={projectName} onClick={onOpenBoard} />
                <span aria-hidden="true"> ›</span>
              </span>
            )}
            {card.displayId && (
              <span className="shrink-0 font-medium text-foreground">{`${card.displayId} ·`}</span>
            )}
            <ScreenTitle look={5} maxLines={1}>
              {card.title}
            </ScreenTitle>
          </div>
          {/* Janela estreita: a branch sai da barra (fica na aba PR & CI e no Ambiente). */}
          {branch && !compactPhaseBar(windowWidth) && (
            <span className="min-w-0 shrink-[4] truncate font-mono text-2xs text-subtle-foreground">
              {branch}
            </span>
          )}
        </div>
      </ScreenBarStart>
      <ScreenBarEnd>
        <TaskPhaseBar
          phases={phases}
          compact={compactPhaseBar(windowWidth)}
          plan={
            liveRun
              ? {
                  label: `Plano do fluxo ${liveRun.flowName}`,
                  open: planOpen,
                  onOpenChange: setPlanOpen,
                  children: <FlowPlanPanel run={liveRun} onCancelled={() => setPlanOpen(false)} />
                }
              : null
          }
        />
        <StageSelector card={card} stages={stages} onMove={onMove} compact />
      </ScreenBarEnd>
      {layout === 'columns' ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col border-r border-border-soft">{session}</div>
          <div className="flex w-[460px] shrink-0 flex-col">{sidePanel}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-[300px] shrink-0 flex-col border-b border-border-soft">
            {sidePanel}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{session}</div>
        </div>
      )}
    </section>
  )
}

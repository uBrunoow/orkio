import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TerminalIcon } from '../../components/icons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScreenTitle } from '../../components/ScreenTitle'
import { TaskFlowSection } from '../task-flows/TaskFlowSection'
import { FlowPlanPanel } from '../task-flows/FlowPlanPanel'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { ReviewPanel } from './ReviewPanel'
import { availableTabs, defaultPanelTab, PANEL_TAB_LABEL, type PanelTab } from './panel-tab'
import { compactPhaseBar, taskLayout } from './task-layout'
import { TaskPhaseBar } from './TaskPhaseBar'
import { CrumbLink, ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { useWindowWidth } from './useWindowWidth'
import { StageSelector, TaskChanges, TaskDetails, TaskGitHub } from './TaskDetails'
import { OpenPrButton, OpenPrFeedback } from './OpenPrButton'
import { EnvironmentPanel } from './EnvironmentPanel'
import { TaskSession } from './TaskSession'
import { TaskViewProvider, useTaskViewState, type TaskViewInput } from './task-view'

/**
 * Tarefa como sessão: fases no topo, a conversa no centro (eventos, execuções do Claude Code,
 * fluxo) com o campo de mensagem e, ao lado (ou acima, em janela estreita), o painel da fase em
 * abas. Os dados da tela têm um dono só (`useTaskViewState`), que as partes leem pelo contexto.
 */
export function TaskPanel({
  onOpenBoard,
  ...input
}: TaskViewInput & {
  onOpenBoard(): void
}): React.JSX.Element {
  const view = useTaskViewState(input)
  const { card, signals, runs, backlog, flow } = view
  // Aba escolhida pela pessoa; até lá, a aba da fase atual (`defaultPanelTab`).
  const [chosenTab, setTab] = useState<PanelTab | null>(
    input.focusSection === 'history' ? 'details' : null
  )
  const windowWidth = useWindowWidth()
  const layout = taskLayout(windowWidth)
  const [planOpen, setPlanOpen] = useState(false)
  const [focusRun, setFocusRun] = useState<{ runId: string; nonce: number } | null>(null)

  const state = runs.state
  const label = card.displayId ?? card.title
  const hasBacklogDoc = !!backlog?.task
  const tabs = availableTabs(hasBacklogDoc, !!signals?.pr)
  const suggested = defaultPanelTab({
    currentPhase: view.currentPhase?.phase ?? null,
    hasBacklogDoc,
    hasDiff: (state?.workspace?.changes ?? 0) > 0 || (state?.runs.length ?? 0) > 0,
    hasPr: !!signals?.pr
  })
  const tab = chosenTab && tabs.includes(chosenTab) ? chosenTab : suggested
  const liveRun = flow.live ? flow.run : null

  const session = (
    <div ref={view.sectionRef('claude')} className="flex h-full min-h-0 flex-col">
      <TaskSession
        flowSlot={
          <div ref={view.sectionRef('flow')} className="flex flex-col">
            <TaskFlowSection
              onOpenRun={(runId) => setFocusRun({ runId, nonce: Date.now() })}
              onShowPlan={() => setPlanOpen(true)}
            />
          </div>
        }
        scrollToEnd={!input.focusSection}
        focusRun={focusRun}
      />
    </div>
  )

  const tabContent: Record<PanelTab, React.ReactNode> = {
    spec: <BacklogDocumentView part="spec" />,
    plan: <BacklogDocumentView part="plan" />,
    changes: <TaskChanges />,
    pr: (
      <div className="flex flex-col gap-6">
        {/* Sem PR aberta e com ambiente: "commits à frente" não é lido aqui (o push recusa se não
            houver nada novo). */}
        {view.openPr.available && (
          <div className="flex flex-col gap-2">
            <OpenPrButton />
            <OpenPrFeedback />
          </div>
        )}
        <TaskGitHub />
      </div>
    ),
    review: <ReviewPanel active={tab === 'review'} />,
    details: (
      <div className="flex flex-col gap-5">
        <EnvironmentPanel />
        <TaskDetails />
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
    <TaskViewProvider value={view}>
      <section aria-label={`Tarefa ${label}`} className="flex h-full min-h-0 flex-col">
        <ScreenBarStart>
          <div className="flex min-w-0 items-center gap-3">
            {/* Sem min-w-0: o título não encolhe abaixo do mínimo dele (sobreporia a branch). */}
            <div className="flex items-center gap-1 text-sm">
              <span className="shrink-0 text-muted-foreground">
                <CrumbLink label={view.projectName} onClick={onOpenBoard} />
                <span aria-hidden="true"> ›</span>
              </span>
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
            phases={view.phases}
            compact={compactPhaseBar(windowWidth)}
            plan={
              liveRun
                ? {
                    label: `Plano do fluxo ${liveRun.flowName}`,
                    open: planOpen,
                    onOpenChange: setPlanOpen,
                    children: <FlowPlanPanel onCancelled={() => setPlanOpen(false)} />
                  }
                : null
            }
          />
          <StageSelector />
          {view.openTerminal && (
            <Button
              size="sm"
              variant="outline"
              onClick={view.openTerminal}
              aria-keyshortcuts="Control+Shift+J"
              title="Terminal na pasta da tarefa (Ctrl/⌘+Shift+J)"
            >
              <TerminalIcon />
              Terminal
            </Button>
          )}
        </ScreenBarEnd>
        {layout === 'columns' ? (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col border-r border-border-soft">
              {session}
            </div>
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
    </TaskViewProvider>
  )
}

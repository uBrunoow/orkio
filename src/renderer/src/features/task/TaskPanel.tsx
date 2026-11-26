import { branchTreeUrl } from './environment'
import type { ProjectRepo } from '../../../../shared/projects'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  BackIcon,
  CommentIcon,
  DiffIcon,
  DocsIcon,
  ExternalLinkIcon,
  GaugeIcon,
  GitBranchIcon,
  ListIcon,
  PanelRightIcon,
  PullRequestIcon,
  ReviewRequestIcon,
  TasksIcon,
  TerminalIcon,
  type SvgIcon
} from '../../components/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScreenTitle } from '../../components/ScreenTitle'
import { TaskFlowSection } from '../task-flows/TaskFlowSection'
import { FlowPlanPanel } from '../task-flows/FlowPlanPanel'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { ReviewPanel } from './ReviewPanel'
import {
  availableTabs,
  canOpen,
  defaultPanelTab,
  isSubview,
  PANEL_TAB_LABEL,
  type PanelTab
} from './panel-tab'
import { compactPhaseBar, taskLayout } from './task-layout'
import { TaskPhaseBar } from './TaskPhaseBar'
import { CrumbLink, ScreenBarEnd, ScreenBarStart } from '../../app/ScreenBar'
import { useWindowWidth } from './useWindowWidth'
import { ResizeHandle, usePanelWidth } from '../../components/ResizeHandle'
import { TaskChanges, TaskDetails, TaskGitHub } from './TaskDetails'
import { OpenPrButton, OpenPrFeedback } from './OpenPrButton'
import { EnvironmentPanel } from './EnvironmentPanel'
import { SessionContextPanel } from './SessionContextPanel'
import { SidechatPanel } from './SidechatPanel'
import { TerminalPage } from '../terminal/TerminalPage'
import { TaskSession } from './TaskSession'
import { TaskViewProvider, useTaskViewState, type TaskViewInput } from './task-view'

const TAB_ICON: Record<PanelTab, SvgIcon> = {
  details: ListIcon,
  changes: DiffIcon,
  sidechat: CommentIcon,
  terminal: TerminalIcon,
  spec: DocsIcon,
  plan: TasksIcon,
  pr: PullRequestIcon,
  review: ReviewRequestIcon,
  context: GaugeIcon
}

/**
 * Tarefa como sessão: fases no topo, a conversa no centro (eventos, execuções do Claude Code,
 * fluxo) com o campo de mensagem e, ao lado (ou acima, em janela estreita), o painel da fase em
 * abas. Os dados da tela têm um dono só (`useTaskViewState`), que as partes leem pelo contexto.
 */
export function TaskPanel({
  onOpenBoard,
  project = null,
  ...input
}: TaskViewInput & {
  onOpenBoard(): void
  /** Repositório do projeto no github.com: a branch do topo vira link para ela lá. */
  /** Projeto da tarefa: o link da branch sai do repositório (`branchTreeUrl`). */
  project?: { repo: ProjectRepo | null } | null
}): React.JSX.Element {
  const view = useTaskViewState(input)
  const { card, signals, backlog, flow } = view
  // Aba escolhida pela pessoa; até lá, a aba da fase atual (`defaultPanelTab`).
  const [chosenTab, setTab] = useState<PanelTab | null>(
    input.focusSection === 'history' ? 'details' : null
  )
  const windowWidth = useWindowWidth()
  // Arrastar a borda muda a largura do painel (guardada neste computador); a conversa fica com
  // pelo menos ~460 px.
  const panelWidth = usePanelWidth('orkio.taskPanelWidth', {
    initial: 460,
    min: 340,
    max: Math.max(340, Math.min(900, windowWidth - 760))
  })
  const layout = taskLayout(windowWidth)
  const [planOpen, setPlanOpen] = useState(false)
  const [focusRun, setFocusRun] = useState<{ runId: string; nonce: number } | null>(null)

  const label = card.displayId ?? card.title
  const hasBacklogDoc = !!backlog?.task
  const hasPr = !!signals?.pr
  const tabs = availableTabs(hasBacklogDoc)
  const suggested = defaultPanelTab({
    currentPhase: view.currentPhase?.phase ?? null,
    hasBacklogDoc
  })
  const tab = chosenTab && canOpen(chosenTab, { hasBacklogDoc, hasPr }) ? chosenTab : suggested
  // Ícone aceso no topo: a subtela (PR & CI, Revisão, Contexto) fica dentro de Detalhes.
  const primary = isSubview(tab) ? 'details' : tab
  const liveRun = flow.live ? flow.run : null
  // As fases vêm do fluxo (fase conhecida ou comando) ou de um fluxo rodando; senão são as colunas.
  const phasesFromFlow =
    !!liveRun || view.phases.some((p) => p.phase !== null || p.id.startsWith('command:'))
  const [panelOpen, setPanelOpen] = useTaskPanelOpen()
  // Terminal da tarefa: abre no painel (aba Terminal), não numa aba nova do app.
  const viewWithPanel = useMemo(
    () => ({
      ...view,
      showPanel: setTab,
      openTerminal: () => {
        setPanelOpen(true)
        setTab('terminal')
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view]
  )

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
    details: (
      <div className="flex flex-col gap-5">
        <EnvironmentPanel onOpen={setTab} />
        <div className="border-t border-border-soft pt-4">
          <TaskDetails />
        </div>
      </div>
    ),
    changes: <TaskChanges />,
    sidechat: <SidechatPanel />,
    terminal:
      tab === 'terminal' ? (
        <div className="-m-[18px] flex h-[calc(100%+36px)] min-h-[360px] flex-col">
          <TerminalPage
            embedded
            projectId={input.projectId}
            taskId={card.taskId}
            onOpenTask={() => setTab('details')}
          />
        </div>
      ) : null,
    spec: <BacklogDocumentView part="spec" />,
    plan: <BacklogDocumentView part="plan" />,
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
    context: <SessionContextPanel />
  }

  const sidePanel = (
    <aside aria-label={`Detalhes de ${label}`} className="flex h-full min-h-0 flex-col bg-surface">
      <Tabs
        value={primary}
        onValueChange={(v) => setTab(tabs.find((t) => t === v) ?? suggested)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="h-[42px] w-full shrink-0 justify-start gap-0.5 rounded-none border-b border-border-soft bg-transparent px-2.5 py-0">
          {tabs.map((t) => {
            const Icon = TAB_ICON[t]
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value={t}
                    // Já no ícone (ex.: Detalhes com uma subtela aberta): volta ao começo dele.
                    onClick={() => setTab(t)}
                    aria-label={PANEL_TAB_LABEL[t]}
                    className="size-8 flex-none rounded-md p-0 text-subtle-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none"
                  >
                    <Icon className="size-4" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{PANEL_TAB_LABEL[t]}</TooltipContent>
              </Tooltip>
            )
          })}
          <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
            {PANEL_TAB_LABEL[tab]}
          </span>
        </TabsList>
        <div
          className={cn(
            'min-h-0 flex-1 p-[18px]',
            tab === 'terminal' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
          )}
        >
          {isSubview(tab) && (
            <section aria-label={PANEL_TAB_LABEL[tab]} className="flex flex-col gap-4">
              <Button
                size="xs"
                variant="ghost"
                className="-ml-2 self-start text-muted-foreground"
                onClick={() => setTab('details')}
              >
                <BackIcon />
                Detalhes
              </Button>
              {tabContent[tab]}
            </section>
          )}
          {tabs.map((t) => (
            // Aba inativa: fica montada (o fluxo e os pedidos continuam vivos fora da aba), mas
            // escondida; com uma subtela aberta, Detalhes também se esconde.
            <TabsContent
              key={t}
              value={t}
              forceMount
              className={cn(
                'flex flex-col data-[state=inactive]:hidden',
                t === 'terminal' && 'min-h-0 flex-1',
                isSubview(tab) && 'hidden'
              )}
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
    <TaskViewProvider value={viewWithPanel}>
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
            {/* Janela estreita: a branch sai da barra (fica em PR & CI e no Ambiente). */}
            {branch && !compactPhaseBar(windowWidth) && (
              <BranchBadge branch={branch} project={project} />
            )}
          </div>
        </ScreenBarStart>
        <ScreenBarEnd>
          {/* Sem fluxo, as fases são as colunas do quadro: o seletor de etapa já mostra isso. */}
          {phasesFromFlow && (
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
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={panelOpen ? 'Esconder o painel da tarefa' : 'Mostrar o painel da tarefa'}
            aria-pressed={panelOpen}
            title={panelOpen ? 'Esconder o painel' : 'Mostrar o painel'}
            className="text-subtle-foreground hover:text-foreground"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <PanelRightIcon />
          </Button>
        </ScreenBarEnd>
        {layout === 'columns' ? (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">{session}</div>
            {panelOpen && (
              <>
                <ResizeHandle label="Largura do painel da tarefa" panel={panelWidth} />
                <div className="flex shrink-0 flex-col" style={{ width: panelWidth.width }}>
                  {sidePanel}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {panelOpen && (
              <div className="flex h-[300px] shrink-0 flex-col border-b border-border-soft">
                {sidePanel}
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">{session}</div>
          </div>
        )}
      </section>
    </TaskViewProvider>
  )
}

/**
 * Branch da tarefa no topo: badge mono; com o repositório no github.com, abre a branch lá
 * (`github.com/<dono>/<repo>/tree/<branch>`, da allowlist de links).
 */
function BranchBadge({
  branch,
  project
}: {
  branch: string
  project: { repo: ProjectRepo | null } | null
}): React.JSX.Element {
  const cls =
    'inline-flex h-6 min-w-0 shrink-[4] items-center gap-1.5 rounded-full border border-border-soft bg-muted px-2 font-mono text-2xs text-muted-foreground'
  const content = (
    <>
      <GitBranchIcon aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{branch}</span>
    </>
  )
  const url = project ? branchTreeUrl(project, branch) : null
  if (!url) {
    return (
      <span className={cls} data-testid="task-branch">
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-testid="task-branch"
      title={`Abrir ${branch} no GitHub`}
      aria-label={`Abrir a branch ${branch} no GitHub`}
      onClick={() => void window.orkio.openExternal(url)}
      className={cn(
        cls,
        'outline-none hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40'
      )}
    >
      {content}
      <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0 text-subtle-foreground" />
    </button>
  )
}

const PANEL_OPEN_KEY = 'orkio.taskPanelOpen'

/** Painel da tarefa aberto ou fechado (só deste computador; padrão aberto). */
function useTaskPanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(PANEL_OPEN_KEY) !== 'false'
    } catch {
      return true
    }
  })
  return [
    open,
    (next) => {
      setOpen(next)
      try {
        window.localStorage.setItem(PANEL_OPEN_KEY, String(next))
      } catch {
        // Sem armazenamento: vale até fechar o app.
      }
    }
  ]
}

/**
 * Dados da tela da tarefa num dono só (`useTaskViewState`, exposto por `TaskViewProvider`): card,
 * execuções do Claude Code, execuções do fluxo, histórico, task do Backlog.md, diff e o "Abrir PR".
 * Cada um carrega uma vez e se atualiza por uma assinatura de `claude.onRunEvent` e uma de
 * `taskFlows.onChanged`; os componentes da tela leem daqui (`useTaskView`) em vez de buscar de novo.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskSection } from '../../../../shared/overview'
import type { PanelTab } from './panel-tab'
import type { AgentBadge } from '../../../../shared/agent'
import type { ClaudeDiff, RunEventMessage } from '../../../../shared/agent-run'
import type { BacklogTaskDocument, BacklogTaskInfo } from '../../../../shared/alva'
import { ALVA_TEMPLATE_IDS } from '../../../../shared/alva-templates'
import type { BoardCard, BoardHistoryEntry, BoardStage } from '../../../../shared/board'
import { isLive } from '../../../../shared/flow-run-state'
import type { FlowRunView, StageFlow } from '../../../../shared/task-flow'
import type { TaskSignals } from '../../../../shared/task-signals'
import {
  createSource,
  ipcCall,
  ipcResult,
  type Source,
  type SourceState,
  unwrap,
  useSource
} from '../../lib/ipc'
import { useTaskRuns, type TaskRuns } from '../claude/useTaskRuns'
import type { ComposerDraft } from '../claude/composer-draft'
import { useProjectFlows } from '../task-flows/useProjectFlows'
import {
  flowPlan,
  flowStepIndex,
  type FlowStepOrigin,
  type PlanStep
} from '../task-flows/flow-plan'
import { canOpenPr, useOpenPr, type OpenPrState } from './open-pr'
import { currentPhase, taskPhases, type TaskPhase } from './task-phases'

export interface TaskActivity {
  who: string
  what: string | null
  /** ISO 8601: quando o passo atual começou. */
  since: string
}

export type BacklogSummary = { linked: string | null; task: BacklogTaskInfo | null }
export type BacklogDocument = { linked: string | null; doc: BacklogTaskDocument | null }

export interface TaskFlowData {
  /** Execuções do fluxo da tarefa, mais nova primeiro (`null` = carregando). */
  runs: FlowRunView[] | null
  run: FlowRunView | null
  plan: PlanStep[] | null
  /** O fluxo está em andamento (rodando, esperando ou pausado). */
  live: boolean
  binding: (StageFlow & { flowName: string }) | null
  ciFlow: { id: string; name: string } | null
  origins: ReadonlyMap<string, FlowStepOrigin>
  reload(): void
}

export interface TaskViewInput {
  projectId: string
  projectName: string
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  agent: AgentBadge | null
  move(stageId: string): void
  setBlocked(blocked: boolean): void
  setAutomationPaused(paused: boolean): void
  refreshSignals(): void
  /** Seção a mostrar ao abrir (sino, notificação): fluxo, Claude Code ou histórico. */
  focusSection: TaskSection | null
  /** Fase 2: abre a aba Terminal da tarefa. */
  openTerminal?: () => void
  /** Sessão do Claude Code escolhida na lista "Sessões" (`null` = a mais recente). */
  session: string | null
  selectSession(session: string | null): void
}

export interface TaskView extends TaskViewInput {
  taskId: string
  stageName(id: string | null): string
  /** Muda a cada evento que mexe nos arquivos/estado da tarefa (execução, fluxo). */
  version: number
  runs: TaskRuns
  history: BoardHistoryEntry[] | null
  flow: TaskFlowData
  backlog: BacklogSummary | null
  /** Texto da task do Backlog.md (lido quando alguém mostra). */
  document: Source<BacklogDocument>
  /** Diff da tarefa (lido quando alguém mostra). */
  diff: Source<ClaudeDiff>
  /** "Abrir PR": um estado só para o botão da aba, o do Ambiente e o do recibo de bloqueio. */
  openPr: OpenPrState & {
    available: boolean
    /** Um fluxo está em andamento (uma execução por vez). */
    blocked: boolean
  }
  activity: TaskActivity | null
  phases: TaskPhase[]
  currentPhase: TaskPhase | null
  /**
   * Ref da seção: quando a seção pedida ao abrir (`focusSection`) aparece na tela, rola até ela
   * (uma vez), sem esperar tempo fixo: o elemento chega quando os dados chegam.
   */
  sectionRef(section: TaskSection): (el: HTMLElement | null) => void
  setComposer(el: HTMLTextAreaElement | null): void
  /** Leva ao campo de mensagem (o texto vai para o Claude): "Pedir ajuste…" do gate. */
  focusComposer(): void
  /**
   * Fase 2: "Editar mensagem"/"Ramificar daqui" põem um rascunho no campo; o campo o pega e limpa.
   * `null` quando a conversa não pode ramificar agora (fluxo em andamento, sessão com você).
   */
  draft: ComposerDraft | null
  setDraft: ((draft: ComposerDraft | null) => void) | null
  /** O campo usou (mandou ou cancelou) o rascunho. */
  clearDraft(): void
  /** Abre uma aba do painel ao lado (o medidor de contexto do campo abre "Contexto"). */
  showPanel: ((tab: PanelTab) => void) | null
}

/** Evento de execução que muda o que a tarefa mostra além da conversa (histórico, spec, diff). */
function touchesTask(m: RunEventMessage): boolean {
  const e = m.event
  return (
    e.kind === 'status' ||
    // Pergunta do Claude (ex.: "Aprova a spec?"): relê a spec/plano para aprovar vendo.
    e.kind === 'question' ||
    (e.kind === 'permission' && e.state === 'blocked')
  )
}

/** Fonte lida sob demanda e relida a cada `version` enquanto alguém a mostra. */
function useLazySource<T>(load: () => Promise<T>, version: number): Source<T> {
  const [source] = useState(() => createSource<T>({ load: () => load() }))
  useEffect(() => {
    for (const key of source.keys()) void source.reload(key, undefined)
  }, [source, version])
  return source
}

export function useTaskViewState(input: TaskViewInput): TaskView {
  const { projectId, card, stages, signals, agent } = input
  const taskId = card.taskId
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((n) => n + 1), [])

  const runs = useTaskRuns(projectId, taskId, (m) => {
    if (touchesTask(m)) bump()
  })
  const reloadRuns = runs.reload

  const [flowRuns, setFlowRuns] = useState<FlowRunView[] | null>(null)
  const projectFlows = useProjectFlows(projectId).value
  const binding = useMemo((): TaskFlowData['binding'] => {
    const b = projectFlows?.bindings.find((x) => x.stageId === card.stageId && x.enabled)
    const flow = b ? projectFlows?.flows.find((f) => f.id === b.flowId) : null
    return b && flow ? { ...b, flowName: flow.name } : null
  }, [projectFlows, card.stageId])
  const ciFlow = useMemo((): TaskFlowData['ciFlow'] => {
    const ci = projectFlows?.flows.find((f) => f.id === ALVA_TEMPLATE_IDS.ci)
    return ci ? { id: ci.id, name: ci.name } : null
  }, [projectFlows])
  useEffect(
    () =>
      window.orkio.taskFlows.onChanged((e) => {
        if (e.taskId !== taskId) return
        bump()
        // "Continuar no Claude" avisa pelo mesmo evento: o estado da sessão muda.
        void reloadRuns()
      }),
    [taskId, bump, reloadRuns]
  )
  useEffect(() => {
    let active = true
    void ipcCall(() => window.orkio.taskFlows.runs(taskId), null).then((r) => {
      if (active && r) setFlowRuns(r)
    })
    return () => {
      active = false
    }
  }, [taskId, version])

  // Histórico: muda com o card (movido, sincronizado, recusado), o agente e os eventos da tarefa.
  const [history, setHistory] = useState<BoardHistoryEntry[] | null>(null)
  useEffect(() => {
    let active = true
    void ipcResult(() => window.orkio.board.history(projectId, taskId)).then((r) => {
      if (active) setHistory(r.ok ? r.value : [])
    })
    return () => {
      active = false
    }
  }, [projectId, taskId, card, agent?.key, version])

  // Task do Backlog.md vinculada (resumo: sempre; texto: quando alguém mostra).
  const [backlog, setBacklog] = useState<BacklogSummary | null>(null)
  useEffect(() => {
    let active = true
    void ipcResult(() => window.orkio.alva.taskSummary(projectId, taskId)).then((r) => {
      if (active) setBacklog(r.ok ? r.value : null)
    })
    return () => {
      active = false
    }
  }, [projectId, taskId, version])
  const document = useLazySource(
    () => window.orkio.alva.taskDocument(projectId, taskId).then(unwrap),
    version
  )
  const diff = useLazySource(
    () => window.orkio.claude.diff(projectId, taskId).then(unwrap),
    version
  )

  const run = flowRuns?.[0] ?? null
  const plan = useMemo(() => (run ? flowPlan(run) : null), [run])
  const origins = useMemo(() => flowStepIndex(flowRuns ?? []), [flowRuns])
  const flowLive = flowRuns?.some((r) => isLive(r.status)) ?? false
  const flow: TaskFlowData = {
    runs: flowRuns,
    run,
    plan,
    live: !!run && isLive(run.status),
    binding,
    ciFlow,
    origins,
    reload: bump
  }

  const state = runs.state
  const activeRun = state?.runs.find((r) => r.id === state.activeRunId) ?? null
  const currentStep = run
    ? [...run.history].reverse().find((h) => h.stepId === run.currentStep && !h.endedAt)
    : undefined
  const activity: TaskActivity | null =
    run?.status === 'running'
      ? {
          who: run.agent?.name ?? 'Fluxo',
          what: run.steps.find((s) => s.id === run.currentStep)?.name ?? null,
          since: currentStep?.startedAt ?? run.startedAt
        }
      : activeRun?.status === 'running'
        ? {
            who: agent && activeRun.agentKey === agent.key ? agent.name : 'Claude Code',
            what: activeRun.command ? `/${activeRun.command}` : null,
            since: activeRun.startedAt
          }
        : null

  const phases = taskPhases({ plan, stages, stageId: card.stageId })
  const openPr = useOpenPr(projectId, taskId)

  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const setComposer = useCallback((el: HTMLTextAreaElement | null) => {
    composerRef.current = el
  }, [])
  const focusComposer = useCallback(() => {
    const field = composerRef.current
    field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    field?.focus()
  }, [])

  // Fase 2: rascunho de "Editar mensagem"/"Ramificar daqui" (só sem fluxo e sem a sessão com você).
  const [draft, setDraftState] = useState<ComposerDraft | null>(null)
  const canFork = !flowLive && !state?.handoff
  const clearDraft = useCallback(() => setDraftState(null), [])
  const setDraft = useCallback(
    (next: ComposerDraft | null) => {
      setDraftState(next)
      if (next) focusComposer()
    },
    [focusComposer]
  )

  const focused = useRef(false)
  const { focusSection } = input
  const sectionRef = useCallback(
    (section: TaskSection) => (el: HTMLElement | null) => {
      if (!el || focused.current || section !== focusSection) return
      focused.current = true
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    [focusSection]
  )

  return {
    ...input,
    taskId,
    stageName: (id) =>
      id ? (stages.find((s) => s.id === id)?.name ?? 'etapa removida') : 'Sem etapa',
    version,
    runs,
    history,
    flow,
    backlog,
    document,
    diff,
    openPr: {
      ...openPr,
      available: canOpenPr(signals?.pr) && !!state?.workspace,
      blocked: flowLive
    },
    activity,
    phases,
    currentPhase: currentPhase(phases),
    sectionRef,
    setComposer,
    focusComposer,
    draft,
    setDraft: canFork ? setDraft : null,
    clearDraft,
    // O painel ao lado é da tela (TaskPanel), que preenche ao montar o contexto.
    showPanel: null
  }
}

const TaskViewContext = createContext<TaskView | null>(null)

export const TaskViewProvider = TaskViewContext.Provider

export function useTaskView(): TaskView {
  const view = useContext(TaskViewContext)
  if (!view) throw new Error('TaskViewProvider ausente')
  return view
}

/** Texto da task do Backlog.md da tarefa (lido ao mostrar; relido a cada evento da tarefa). */
export function useTaskDocument(): SourceState<BacklogDocument> {
  const view = useTaskView()
  return useSource(view.document, view.taskId)
}

/** Diff da tarefa (lido ao mostrar; relido a cada evento da tarefa). */
export function useTaskDiff(enabled = true): SourceState<ClaudeDiff> {
  const view = useTaskView()
  return useSource(view.diff, enabled ? view.taskId : null)
}

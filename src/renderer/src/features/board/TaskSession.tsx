import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Timestamp } from '@/components/Timestamp'
import type { AgentBadge } from '../../../../shared/agent'
import type { AgentRunView } from '../../../../shared/agent-run'
import type { BoardHistoryEntry } from '../../../../shared/ipc-contract'
import { branchUrl, describeEvent, prNumber, prUrl } from '../../../../shared/task-history'
import { StatusToken } from '../../components/StatusToken'
import { ExternalLinkIcon } from '../../components/icons'
import { AgentAvatar } from '../agents/AgentAvatar'
import { QuestionCard } from '../claude/QuestionCard'
import { RunBlock } from '../claude/RunBlock'
import { SessionComposer } from '../claude/SessionComposer'
import { Composer, EMPTY_INITIAL, PermissionCard, type RunInitial } from '../claude/session-parts'
import { pendingRequests, type useTaskRuns } from '../claude/useTaskRuns'
import { buildTranscript, runningSubagents, waitingSubagentsLabel } from '../claude/run-transcript'
import type { TaskActivity } from '../task-flows/TaskFlowSection'
import type { FlowStepOrigin } from '../task-flows/flow-plan'
import { eventActor } from './TaskTimeline'
import { buildSession, tailSession, type SessionItem } from './task-session'

/** Comandos que criam ou atualizam a spec/plano no Backlog.md (alva-flow). */
export function isDocCommand(command: string | null): boolean {
  return !!command && /(^|:)(spec|plan)$/.test(command)
}

/** Quantos itens a conversa mostra antes de "Mostrar anteriores". */
const TAIL = 30

type Runs = ReturnType<typeof useTaskRuns>

/**
 * Sessão da tarefa: uma conversa só com os eventos (Notion, GitHub, fluxo, você), as execuções do
 * Claude Code e, no fim, o que está acontecendo agora (fluxo, pedidos esperando você, quem está
 * trabalhando) e o campo de mensagem. A decisão pendente fica logo acima do campo, onde o olho
 * já está; o topo da tarefa avisa e leva até ela.
 */
export function TaskSession({
  projectId,
  taskId,
  agent,
  history,
  stageName,
  runs,
  flowSlot,
  flowRunning,
  activity,
  scrollToEnd = false,
  focusRun = null,
  backlogLinked = false,
  flowOrigins,
  canOpenPr = false
}: {
  projectId: string
  taskId: string
  agent: AgentBadge | null
  history: readonly BoardHistoryEntry[] | null
  stageName(id: string | null): string
  runs: Runs
  /** Seção do fluxo (5A): estado, decisões e problemas do fluxo da tarefa. */
  flowSlot: React.ReactNode
  /** Um passo de fluxo está rodando: o campo fica bloqueado. */
  flowRunning: boolean
  activity: TaskActivity | null
  /** Ao abrir (painel), rola até o fim da conversa, onde está o que importa agora. */
  scrollToEnd?: boolean
  /** "Ver a sessão do passo" (cartão de problema do fluxo): abre e mostra esta execução. */
  focusRun?: { runId: string; nonce: number } | null
  /** Tarefa com task do Backlog.md vinculada: /spec e /plan mostram o documento na conversa. */
  backlogLinked?: boolean
  /** Execução → passo do fluxo que a disparou (turnos do piloto automático). */
  flowOrigins?: ReadonlyMap<string, FlowStepOrigin>
  /** Sem PR aberta e com ambiente: o recibo de push/gh bloqueado oferece "Abrir PR". */
  canOpenPr?: boolean
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const [newSession, setNewSession] = useState<Awaited<
    ReturnType<typeof window.orkio.claude.prepare>
  > | null>(null)
  const [initial, setInitial] = useState<RunInitial>(EMPTY_INITIAL)
  const [preparing, setPreparing] = useState(false)
  const state = runs.state
  const items = useMemo(
    () => (history && state ? buildSession(history, state.runs, new Date()) : null),
    [history, state]
  )
  const visible = items ? (showAll ? { items, hidden: 0 } : tailSession(items, TAIL)) : null
  const ready = visible !== null
  const latestId = state?.runs[0]?.id ?? null
  // O documento (spec/plano) abre só na execução mais recente que o mexeu; as mudanças, na mais
  // recente que mudou arquivos. As anteriores ficam recolhidas (é o mesmo arquivo, o mesmo diff).
  const docRuns = new Set(
    backlogLinked ? (state?.runs ?? []).filter((r) => isDocCommand(r.command)).map((r) => r.id) : []
  )
  const docOpenId = (state?.runs ?? []).find((r) => docRuns.has(r.id))?.id ?? null
  const changesOpenId =
    (state?.runs ?? []).find((r) => (r.summary?.files.length ?? 0) > 0)?.id ?? null
  const endId = `session-end-${taskId}`
  useEffect(() => {
    if (!scrollToEnd || !ready) return
    const timer = setTimeout(
      () => document.getElementById(endId)?.scrollIntoView({ block: 'end' }),
      50
    )
    return () => clearTimeout(timer)
    // Também quando uma execução nova começa (mensagem enviada, passo do fluxo).
  }, [scrollToEnd, ready, endId, latestId])
  const liveLog = latestId && runs.selectedRunId === latestId ? runs.log : null
  const active = state?.runs.find((r) => r.id === state.activeRunId) ?? null
  const pending = active && runs.selectedRunId === active.id ? pendingRequests(runs.log) : []
  const trackedLog = active && runs.selectedRunId === active.id ? runs.log : null
  const waitingSubagents = useMemo(
    () =>
      trackedLog
        ? waitingSubagentsLabel(runningSubagents(buildTranscript(trackedLog, true)))
        : null,
    [trackedLog]
  )
  // "Rodar de novo" só sem nada rodando (execução ou passo de fluxo) e sem formulário aberto.
  const canRerun = !active && !flowRunning && !newSession

  const openNewSession = async (from: AgentRunView | null = null): Promise<void> => {
    if (preparing) return
    setInitial(
      from ? { mode: from.mode, command: from.command ?? '', text: from.text ?? '' } : EMPTY_INITIAL
    )
    setPreparing(true)
    const r = await window.orkio.claude.prepare(projectId, taskId)
    setPreparing(false)
    setNewSession(r)
  }

  return (
    <section aria-label="Sessão da tarefa" className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
        {!visible ? (
          <Skeleton className="h-[60px]" aria-label="Carregando a sessão" />
        ) : (
          <ul role="list" aria-label="Conversa da tarefa" className="flex flex-col gap-4">
            {visible.hidden > 0 && (
              <li className="flex justify-center">
                <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                  {`Mostrar ${visible.hidden} ${visible.hidden === 1 ? 'item anterior' : 'itens anteriores'}`}
                </Button>
              </li>
            )}
            {visible.items.length === 0 && (
              <li className="text-xs text-muted-foreground">
                Nada aconteceu nesta tarefa ainda. Escreva abaixo para o Claude começar.
              </li>
            )}
            {visible.items.map((item) => (
              <SessionRow
                key={
                  item.kind === 'run' && focusRun?.runId === item.run.id
                    ? `${item.key}:${focusRun.nonce}`
                    : item.key
                }
                focused={item.kind === 'run' && focusRun?.runId === item.run.id}
                projectId={projectId}
                showDocument={
                  item.kind === 'run' && docRuns.has(item.run.id)
                    ? item.run.id === docOpenId
                      ? 'open'
                      : true
                    : false
                }
                changesOpen={item.kind === 'run' && item.run.id === changesOpenId}
                origin={item.kind === 'run' ? (flowOrigins?.get(item.run.id) ?? null) : null}
                canOpenPr={canOpenPr}
                item={item}
                agent={agent}
                stageName={stageName}
                liveLog={item.kind === 'run' && item.run.id === latestId ? liveLog : null}
                {...(canRerun ? { onRerun: (run: AgentRunView) => void openNewSession(run) } : {})}
              />
            ))}
          </ul>
        )}

        {flowSlot}

        {active && pending.length > 0 && (
          <div className="flex flex-col gap-3" id={`claude-waiting-${taskId}`}>
            {pending.map((p) =>
              p.kind === 'permission' ? (
                <PermissionCard key={p.requestId} runId={active.id} request={p} />
              ) : (
                <QuestionCard
                  key={p.requestId}
                  questions={p.questions}
                  onAnswer={(answers) =>
                    void window.orkio.claude.answerQuestion(active.id, p.requestId, answers)
                  }
                />
              )
            )}
          </div>
        )}

        {activity && (
          <div
            role="status"
            aria-label="Trabalhando agora"
            data-testid="task-working"
            className="flex min-w-0 items-center gap-2 text-xs"
          >
            <StatusToken tone="running" label={`${activity.who} trabalhando há`} />
            <Elapsed since={activity.since} />
            {activity.what && (
              <span className="min-w-0 truncate font-mono text-subtle-foreground">
                · {activity.what}
              </span>
            )}
          </div>
        )}

        <div id={endId} />
      </div>
      {/* O campo fica preso embaixo, fora da rolagem: é onde o olho está. */}
      <div className="shrink-0 border-t border-border-soft px-7 pt-3 pb-4">
        {waitingSubagents && (
          <p
            role="status"
            aria-label="Esperando subagentes"
            data-testid="waiting-subagents"
            className="mb-2 min-w-0 truncate text-xs text-muted-foreground"
          >
            {waitingSubagents}
          </p>
        )}
        {newSession ? (
          newSession.ok ? (
            <Composer
              prep={newSession.value}
              initial={initial}
              projectId={projectId}
              onCancel={() => setNewSession(null)}
              onStarted={(s) => {
                setNewSession(null)
                runs.setState(s)
                void runs.select(s.activeRunId)
              }}
            />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs">{newSession.error.message}</p>
              <Button size="sm" variant="ghost" onClick={() => setNewSession(null)}>
                Fechar
              </Button>
            </div>
          )
        ) : (
          <SessionComposer
            projectId={projectId}
            taskId={taskId}
            agent={agent}
            state={state}
            flowRunning={flowRunning}
            autopilotStep={flowRunning ? (activity?.what ?? null) : null}
            onSent={(s) => {
              runs.setState(s)
              void runs.select(s.activeRunId)
            }}
            onNewSession={() => void openNewSession()}
          />
        )}
      </div>
    </section>
  )
}

/** Tempo desde `since`, atualizado a cada segundo ("0:42", "12:05", "1:02:10"). */
function Elapsed({ since }: { since: string }): React.JSX.Element {
  const start = Date.parse(since)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const total = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now - start) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  const text = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
  return <span className="tabular font-mono text-muted-foreground">{text}</span>
}

function SessionRow({
  item,
  agent,
  stageName,
  liveLog,
  onRerun,
  focused,
  projectId,
  showDocument,
  changesOpen,
  origin,
  canOpenPr
}: {
  item: SessionItem
  origin: FlowStepOrigin | null
  canOpenPr: boolean
  focused: boolean
  projectId: string
  showDocument: boolean | 'open'
  changesOpen: boolean
  agent: AgentBadge | null
  stageName(id: string | null): string
  liveLog: Parameters<typeof RunBlock>[0]['liveLog']
  onRerun?: (run: AgentRunView) => void
}): React.JSX.Element {
  if (item.kind === 'day') {
    return (
      <li className="flex items-center gap-3 text-2xs text-subtle-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border-soft" />
        <span>{item.label}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border-soft" />
      </li>
    )
  }
  if (item.kind === 'run') {
    return (
      <li className="flex flex-col">
        <RunBlock
          run={item.run}
          agent={agent}
          liveLog={liveLog}
          focused={focused}
          projectId={projectId}
          showDocument={showDocument}
          changesOpen={changesOpen}
          origin={origin}
          canOpenPr={canOpenPr}
          {...(onRerun && !origin ? { onRerun: () => onRerun(item.run) } : {})}
        />
      </li>
    )
  }
  const e = item.entry
  const actor = eventActor(e)
  const link = prUrl(e) ?? branchUrl(e)
  return (
    <li data-testid="session-event" className="flex min-w-0 items-center gap-2.5">
      {'agent' in actor ? (
        <AgentAvatar
          name={actor.name}
          color={agent?.name === actor.name ? agent.color : 'blue'}
          {...(agent?.name === actor.name ? { seed: agent.key } : {})}
        />
      ) : (
        <actor.icon className="size-3.5 text-subtle-foreground" />
      )}
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{actor.name}</span> ·{' '}
        {describeEvent(e, stageName)} ·{' '}
        <Timestamp value={e.at} className="text-subtle-foreground" />
      </p>
      {link && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={
            prNumber(e) !== null
              ? `Abrir a PR #${prNumber(e)} no GitHub`
              : 'Abrir a branch no GitHub'
          }
          onClick={() => void window.orkio.openExternal(link)}
        >
          <ExternalLinkIcon />
        </Button>
      )}
    </li>
  )
}

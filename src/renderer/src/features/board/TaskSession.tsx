import { useEffect, useMemo, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Timer } from '@astryxdesign/core/Timer'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { VStack } from '@astryxdesign/core/VStack'
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
import type { TaskActivity } from '../task-flows/TaskFlowSection'
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
  backlogLinked = false
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
    <VStack gap={4} role="region" aria-label="Sessão da tarefa">
      {!visible ? (
        <Skeleton height={60} aria-label="Carregando a sessão" />
      ) : (
        <VStack gap={3} role="list" aria-label="Conversa da tarefa">
          {visible.hidden > 0 && (
            <HStack hAlign="center">
              <Button
                size="sm"
                variant="ghost"
                label={`Mostrar ${visible.hidden} ${visible.hidden === 1 ? 'item anterior' : 'itens anteriores'}`}
                onClick={() => setShowAll(true)}
              />
            </HStack>
          )}
          {visible.items.length === 0 && (
            <Text type="supporting" color="secondary">
              Nada aconteceu nesta tarefa ainda. Escreva abaixo para o Claude começar.
            </Text>
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
              item={item}
              agent={agent}
              stageName={stageName}
              liveLog={item.kind === 'run' && item.run.id === latestId ? liveLog : null}
              {...(canRerun ? { onRerun: (run: AgentRunView) => void openNewSession(run) } : {})}
            />
          ))}
        </VStack>
      )}

      {flowSlot}

      {active && pending.length > 0 && (
        <VStack gap={3} id={`claude-waiting-${taskId}`}>
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
        </VStack>
      )}

      {activity && (
        <HStack
          gap={2}
          vAlign="center"
          role="status"
          aria-label="Trabalhando agora"
          data-testid="task-working"
        >
          <StatusToken tone="running" label={`${activity.who} trabalhando há`} />
          <Timer startTime={Date.parse(activity.since)} />
          {activity.what && (
            <Text type="supporting" color="secondary" maxLines={1}>
              · {activity.what}
            </Text>
          )}
        </HStack>
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
          <VStack gap={2}>
            <Text type="supporting">{newSession.error.message}</Text>
            <HStack>
              <Button
                size="sm"
                variant="ghost"
                label="Fechar"
                onClick={() => setNewSession(null)}
              />
            </HStack>
          </VStack>
        )
      ) : (
        <SessionComposer
          projectId={projectId}
          taskId={taskId}
          agent={agent}
          state={state}
          flowRunning={flowRunning}
          onSent={(s) => {
            runs.setState(s)
            void runs.select(s.activeRunId)
          }}
          onNewSession={() => void openNewSession()}
        />
      )}
      <VStack id={endId} />
    </VStack>
  )
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
  changesOpen
}: {
  item: SessionItem
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
      <VStack role="listitem">
        <Divider label={item.label} />
      </VStack>
    )
  }
  if (item.kind === 'run') {
    return (
      <VStack role="listitem">
        <RunBlock
          run={item.run}
          agent={agent}
          liveLog={liveLog}
          focused={focused}
          projectId={projectId}
          showDocument={showDocument}
          changesOpen={changesOpen}
          {...(onRerun ? { onRerun: () => onRerun(item.run) } : {})}
        />
      </VStack>
    )
  }
  const e = item.entry
  const actor = eventActor(e)
  const link = prUrl(e) ?? branchUrl(e)
  return (
    <HStack gap={2} vAlign="center" role="listitem" data-testid="session-event">
      {'agent' in actor ? (
        <AgentAvatar
          name={actor.name}
          color={agent?.name === actor.name ? agent.color : 'blue'}
          {...(agent?.name === actor.name ? { seed: agent.key } : {})}
        />
      ) : (
        <Icon icon={actor.icon} color="secondary" size="sm" />
      )}
      <StackItem size="fill">
        <Text type="supporting" color="secondary">
          <Text as="span" type="supporting" weight="medium">
            {actor.name}
          </Text>{' '}
          · {describeEvent(e, stageName)} · <Timestamp value={e.at} format="auto" />
        </Text>
      </StackItem>
      {link && (
        <IconButton
          size="sm"
          variant="ghost"
          label={
            prNumber(e) !== null
              ? `Abrir a PR #${prNumber(e)} no GitHub`
              : 'Abrir a branch no GitHub'
          }
          icon={<Icon icon={ExternalLinkIcon} />}
          onClick={() => void window.orkio.openExternal(link)}
        />
      )}
    </HStack>
  )
}

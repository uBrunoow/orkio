import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { AgentBadge } from '../../../../shared/agent'
import type { BacklogTaskInfo } from '../../../../shared/alva'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardStage,
  TaskSignals
} from '../../../../shared/ipc-contract'
import { StatusToken } from '../../components/StatusToken'
import { ExternalLinkIcon } from '../../components/icons'
import { plural } from '../../lib/format'
import { TaskAgentSection } from '../agents/TaskAgentSection'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { TaskArtifacts } from '../claude/TaskArtifacts'
import { Workspace } from '../claude/session-parts'
import type { useTaskRuns } from '../claude/useTaskRuns'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import { TaskTimeline } from './TaskTimeline'

export type BacklogSummary = { linked: string | null; task: BacklogTaskInfo | null }

/** Task do Backlog.md vinculada (alva-flow, 5B), lida do arquivo; nada é guardado. */
export function useBacklogSummary(
  projectId: string,
  taskId: string,
  refreshKey: unknown
): BacklogSummary | null {
  const [backlog, setBacklog] = useState<BacklogSummary | null>(null)
  useEffect(() => {
    let active = true
    void window.orkio.alva.taskSummary(projectId, taskId).then((r) => {
      if (active) setBacklog(r.ok ? r.value : null)
    })
    return () => {
      active = false
    }
  }, [projectId, taskId, refreshKey])
  return backlog
}

function Section({
  title,
  children,
  testId
}: {
  title: string
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <VStack gap={2} role="region" aria-label={title} {...(testId ? { 'data-testid': testId } : {})}>
      <Heading level={3}>{title}</Heading>
      {children}
    </VStack>
  )
}

/**
 * O que mudou no código: resumo da última execução (arquivos, commits, testes), o ambiente da
 * tarefa (editores, diff, limpar) e os documentos para anexar/publicar no Notion.
 */
export function TaskChanges({
  projectId,
  taskId,
  stageName,
  runs
}: {
  projectId: string
  taskId: string
  stageName: string | null
  runs: ReturnType<typeof useTaskRuns>
}): React.JSX.Element {
  const state = runs.state
  const summary = state?.runs.find((r) => r.summary)?.summary ?? null
  const changes = state?.workspace?.changes ?? null
  return (
    <Section title="Mudanças">
      {state === null ? (
        <Skeleton height={40} aria-label="Carregando mudanças" />
      ) : !state.workspace && !summary ? (
        <Text type="supporting" color="secondary">
          Nada mudou no código ainda. A pasta de trabalho da tarefa é criada quando o Claude começa.
        </Text>
      ) : (
        <VStack gap={2}>
          {summary && (
            <Text data-testid="changes-summary">
              {plural(summary.files.length, 'arquivo', 'arquivos')} ·{' '}
              {plural(summary.commits.length, 'commit', 'commits')}
              {changes ? ` · ${changes} sem commit` : ''}
            </Text>
          )}
          {summary && summary.files.length > 0 && (
            <VStack gap={0}>
              {summary.files.slice(0, 5).map((f) => (
                <Text key={f} type="supporting" color="secondary" maxLines={1}>
                  <Code>{f}</Code>
                </Text>
              ))}
              {summary.files.length > 5 && (
                <Text type="supporting" color="secondary">
                  e mais {summary.files.length - 5}
                </Text>
              )}
            </VStack>
          )}
          {state.workspace && (
            <Workspace
              projectId={projectId}
              taskId={taskId}
              workspace={state.workspace}
              isBusy={state.activeRunId !== null}
              suggestCleanup={stageName !== null && /finaliz/i.test(stageName)}
              onChanged={() => void runs.reload()}
            />
          )}
        </VStack>
      )}
      {state && (
        <TaskArtifacts
          projectId={projectId}
          taskId={taskId}
          runId={state.runs[0]?.id ?? null}
          refreshKey={`${state.runs.length}:${state.activeRunId ?? ''}:${state.workspace?.changes ?? ''}`}
        />
      )}
    </Section>
  )
}

/**
 * Estado da tarefa: etapa (mover), GitHub, documentos do Backlog.md, agente, opções e o histórico
 * completo (todos os eventos, recolhido: a sessão já conta o que importa).
 */
export function TaskDetails({
  projectId,
  card,
  stages,
  signals,
  agent,
  backlog,
  history,
  stageName,
  onMove,
  onToggleBlocked,
  onToggleAutomation,
  showStage = true,
  changes = null
}: {
  projectId: string
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  agent: AgentBadge | null
  backlog: BacklogSummary | null
  history: readonly BoardHistoryEntry[] | null
  stageName(id: string | null): string
  onMove(stageId: string): void
  onToggleBlocked(blocked: boolean): void
  onToggleAutomation(paused: boolean): void
  /** O seletor de etapa (no painel do Quadro ele já aparece no topo). */
  showStage?: boolean
  /** Mudanças (página inteira): logo depois da etapa, antes do GitHub. */
  changes?: React.ReactNode
}): React.JSX.Element {
  const [specOpen, setSpecOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  return (
    <VStack gap={5}>
      {showStage && (
        <Section title="Etapa">
          <StageSelector card={card} stages={stages} onMove={onMove} />
        </Section>
      )}

      {changes}

      <Section title="GitHub">
        {signals &&
        (signals.localBranches.length > 0 || signals.remoteBranches.length > 0 || signals.pr) ? (
          <TaskSignalsLine signals={signals} />
        ) : (
          <Text type="supporting" color="secondary">
            Sem branch nem PR ainda.
          </Text>
        )}
      </Section>

      {backlog?.linked && (
        <Section title="Documentos">
          <Text type="supporting" data-testid="alva-task">
            {backlog.task
              ? `Backlog: ${backlog.task.id} · ${backlog.task.status} · critérios ${backlog.task.criteria.done}/${backlog.task.criteria.total}${backlog.task.openQuestions > 0 ? ` · ${plural(backlog.task.openQuestions, 'pergunta em aberto', 'perguntas em aberto')}` : ''}`
              : `Backlog: ${backlog.linked} (arquivo não encontrado na pasta de trabalho)`}
          </Text>
          {backlog.task && (
            <Collapsible
              chevronPosition="start"
              isOpen={specOpen}
              onOpenChange={setSpecOpen}
              trigger={
                <Text type="supporting" color="primary">
                  Spec e plano
                </Text>
              }
            >
              {specOpen && <BacklogDocumentView projectId={projectId} taskId={card.taskId} />}
            </Collapsible>
          )}
        </Section>
      )}

      <TaskAgentSection projectId={projectId} taskId={card.taskId} agent={agent} />

      <Section title="Opções">
        <CheckboxInput
          label="Bloqueada"
          value={card.blocked}
          onChange={(checked) => onToggleBlocked(checked)}
        />
        <CheckboxInput
          label="Pausar automações desta tarefa"
          value={card.automationPaused}
          onChange={(checked) => onToggleAutomation(checked)}
        />
        {card.assignees.length > 0 && (
          <Text type="supporting">Responsável no Notion: {card.assignees.join(', ')}</Text>
        )}
        {card.url && (
          <HStack>
            <Button
              variant="ghost"
              size="sm"
              label="Abrir no Notion"
              icon={<Icon icon={ExternalLinkIcon} />}
              onClick={() => void window.orkio.openExternal(card.url!)}
            />
          </HStack>
        )}
      </Section>

      <VStack data-panel-section="history">
        <Collapsible
          chevronPosition="start"
          isOpen={historyOpen}
          onOpenChange={setHistoryOpen}
          trigger={<Text weight="semibold">Histórico completo</Text>}
        >
          {history === null ? (
            <Skeleton height={40} aria-label="Carregando histórico" />
          ) : history.length === 0 ? (
            <Text type="supporting">Sem eventos ainda.</Text>
          ) : (
            <TaskTimeline history={history} agent={agent} stageName={stageName} />
          )}
        </Collapsible>
      </VStack>
    </VStack>
  )
}

/** "Mover para" + o status do Notion e a sincronização. */
export function StageSelector({
  card,
  stages,
  onMove,
  compact = false
}: {
  card: BoardCard
  stages: readonly BoardStage[]
  onMove(stageId: string): void
  compact?: boolean
}): React.JSX.Element {
  return (
    <VStack gap={1}>
      <Selector
        label="Mover para"
        isLabelHidden={compact}
        {...(compact ? { size: 'sm' as const } : {})}
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
        {...(card.stageId ? { value: card.stageId } : { placeholder: 'Sem etapa' })}
        onChange={(value: string) => {
          if (value !== card.stageId) onMove(value)
        }}
      />
      {
        <HStack gap={2} wrap="wrap" vAlign="center">
          {card.status && (
            <Text type="supporting" color="secondary">
              Notion: {card.status.name}
            </Text>
          )}
          {card.priority && (
            <Text type="supporting" color="secondary" data-testid="task-priority">
              {card.status ? '· ' : ''}
              {card.priority.name}
            </Text>
          )}
          {card.sync.state === 'pending' && <StatusToken tone="warning" label="Sincronizando" />}
        </HStack>
      }
      {card.sync.state === 'pending' && card.sync.message && (
        <Text type="supporting">{card.sync.message}</Text>
      )}
    </VStack>
  )
}

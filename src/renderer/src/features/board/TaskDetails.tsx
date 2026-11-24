import { useEffect, useState } from 'react'
import { IconChevronRight } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckboxField, SelectField } from '@/components/form'
import { cn } from '@/lib/utils'
import type { AgentBadge } from '../../../../shared/agent'
import type { BacklogTaskInfo } from '../../../../shared/alva'
import { StatusToken } from '../../components/StatusToken'
import { ExternalLinkIcon } from '../../components/icons'
import { plural } from '../../lib/format'
import { TaskAgentSection } from '../agents/TaskAgentSection'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { TaskArtifacts } from '../claude/TaskArtifacts'
import { Workspace } from '../claude/session-parts'
import type { useTaskRuns } from '../claude/useTaskRuns'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import { TaskBranchLinks } from './TaskBranchLinks'
import { TaskTimeline } from './TaskTimeline'
import type { BoardCard, BoardHistoryEntry, BoardStage } from '../../../../shared/board'
import type { TaskSignals } from '../../../../shared/task-signals'

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
    <section
      aria-label={title}
      className="flex flex-col gap-2.5"
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <h3 className="text-2xs font-medium tracking-wider text-subtle-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Gatilho de seção recolhível: chevron que gira + rótulo. */
export function CollapsibleHeader({
  open,
  children,
  className
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
        className
      )}
    >
      <IconChevronRight
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 text-subtle-foreground transition-transform',
          open && 'rotate-90'
        )}
      />
      {children}
    </CollapsibleTrigger>
  )
}

/**
 * O que mudou no código: resumo da última execução (arquivos, commits, testes), o ambiente da
 * tarefa (editores, diff, limpar) e os documentos para anexar/publicar no Notion.
 */
export function TaskChanges({
  projectId,
  taskId,
  done,
  runs
}: {
  projectId: string
  taskId: string
  /** A tarefa está na etapa concluída (papel `done`): sugere limpar o ambiente. */
  done: boolean
  runs: ReturnType<typeof useTaskRuns>
}): React.JSX.Element {
  const state = runs.state
  const summary = state?.runs.find((r) => r.summary)?.summary ?? null
  const changes = state?.workspace?.changes ?? null
  return (
    <Section title="Mudanças">
      {state === null ? (
        <Skeleton className="h-10" aria-label="Carregando mudanças" />
      ) : !state.workspace && !summary ? (
        <p className="text-xs text-muted-foreground">
          Nada mudou no código ainda. A pasta de trabalho da tarefa é criada quando o Claude começa.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {summary && (
            <p data-testid="changes-summary" className="text-sm">
              {plural(summary.files.length, 'arquivo', 'arquivos')} ·{' '}
              {plural(summary.commits.length, 'commit', 'commits')}
              {changes ? ` · ${changes} sem commit` : ''}
            </p>
          )}
          {summary && summary.files.length > 0 && (
            <div className="flex flex-col gap-0.5 rounded-lg border border-border-soft bg-card px-2.5 py-2 font-mono text-xs text-muted-foreground">
              {summary.files.slice(0, 5).map((f) => (
                <span key={f} className="truncate">
                  {f}
                </span>
              ))}
              {summary.files.length > 5 && (
                <span className="font-sans text-subtle-foreground">
                  e mais {summary.files.length - 5}
                </span>
              )}
            </div>
          )}
          {state.workspace && (
            <Workspace
              projectId={projectId}
              taskId={taskId}
              workspace={state.workspace}
              isBusy={state.activeRunId !== null}
              suggestCleanup={done}
              onChanged={() => void runs.reload()}
            />
          )}
        </div>
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
  onBranchesChanged,
  showStage = true,
  changes = null,
  part = 'all'
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
  /** Vinculou/desvinculou uma branch: relê os sinais da tarefa. */
  onBranchesChanged?: () => void
  /** O seletor de etapa (no painel do Quadro ele já aparece no topo). */
  showStage?: boolean
  /** Mudanças (página inteira): logo depois da etapa, antes do GitHub. */
  changes?: React.ReactNode
  /** Aba do painel da tarefa: `pr` = só GitHub; `details` = tudo menos GitHub. */
  part?: 'all' | 'pr' | 'details'
}): React.JSX.Element {
  const [specOpen, setSpecOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      {showStage && part !== 'pr' && (
        <Section title="Etapa">
          <StageSelector card={card} stages={stages} onMove={onMove} />
        </Section>
      )}

      {changes}

      {part !== 'details' && (
        <Section title="GitHub">
          {signals &&
          (signals.localBranches.length > 0 || signals.remoteBranches.length > 0 || signals.pr) ? (
            <TaskSignalsLine signals={signals} />
          ) : (
            <p className="text-xs text-muted-foreground">Sem branch nem PR ainda.</p>
          )}
          <TaskBranchLinks
            projectId={projectId}
            taskId={card.taskId}
            {...(onBranchesChanged ? { onChanged: onBranchesChanged } : {})}
          />
        </Section>
      )}
      {part !== 'pr' && (
        <>
          {backlog?.linked && (
            <Section title="Documentos">
              <p className="font-mono text-xs text-muted-foreground" data-testid="alva-task">
                {backlog.task
                  ? `Backlog: ${backlog.task.id} · ${backlog.task.status} · critérios ${backlog.task.criteria.done}/${backlog.task.criteria.total}${backlog.task.openQuestions > 0 ? ` · ${plural(backlog.task.openQuestions, 'pergunta em aberto', 'perguntas em aberto')}` : ''}`
                  : `Backlog: ${backlog.linked} (arquivo não encontrado na pasta de trabalho)`}
              </p>
              {backlog.task && (
                <Collapsible
                  open={specOpen}
                  onOpenChange={setSpecOpen}
                  className="flex flex-col gap-2"
                >
                  <CollapsibleHeader open={specOpen} className="text-sm">
                    Spec e plano
                  </CollapsibleHeader>
                  <CollapsibleContent>
                    {specOpen && <BacklogDocumentView projectId={projectId} taskId={card.taskId} />}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </Section>
          )}

          <TaskAgentSection projectId={projectId} taskId={card.taskId} agent={agent} />

          <Section title="Opções">
            <CheckboxField
              label="Bloqueada"
              checked={card.blocked}
              onChange={(checked) => onToggleBlocked(checked)}
            />
            <CheckboxField
              label="Pausar automações desta tarefa"
              checked={card.automationPaused}
              onChange={(checked) => onToggleAutomation(checked)}
            />
            {card.assignees.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Responsável no Notion: {card.assignees.join(', ')}
              </p>
            )}
            {card.url && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void window.orkio.openExternal(card.url!)}
                >
                  <ExternalLinkIcon />
                  Abrir no Notion
                </Button>
              </div>
            )}
          </Section>

          <div data-panel-section="history">
            <Collapsible
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              className="flex flex-col gap-2.5"
            >
              <CollapsibleHeader open={historyOpen} className="text-sm font-medium">
                Histórico completo
              </CollapsibleHeader>
              <CollapsibleContent>
                {history === null ? (
                  <Skeleton className="h-10" aria-label="Carregando histórico" />
                ) : history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem eventos ainda.</p>
                ) : (
                  <TaskTimeline history={history} agent={agent} stageName={stageName} />
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        </>
      )}
    </div>
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
    <div className={cn('flex gap-1.5', compact ? 'items-center' : 'flex-col')}>
      <SelectField
        className={compact ? 'w-36' : undefined}
        label="Mover para"
        labelHidden={compact}
        {...(compact ? { size: 'sm' as const } : {})}
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
        value={card.stageId ?? null}
        placeholder="Sem etapa"
        onChange={(value: string) => {
          if (value !== card.stageId) onMove(value)
        }}
      />
      {!compact && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {card.status && <span>Notion: {card.status.name}</span>}
          {card.priority && (
            <span data-testid="task-priority">
              {card.status ? '· ' : ''}
              {card.priority.name}
            </span>
          )}
          {card.sync.state === 'pending' && <StatusToken tone="warning" label="Sincronizando" />}
        </p>
      )}
      {compact && card.sync.state === 'pending' && (
        <StatusToken tone="warning" label="Sincronizando" />
      )}
      {card.sync.state === 'pending' && card.sync.message && (
        <p className="text-xs text-muted-foreground">{card.sync.message}</p>
      )}
    </div>
  )
}

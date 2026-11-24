import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckboxField, SelectField } from '@/components/form'
import { StatusToken } from '../../components/StatusToken'
import { ExternalLinkIcon } from '../../components/icons'
import { plural } from '../../lib/format'
import { TaskAgentSection } from '../agents/TaskAgentSection'
import { BacklogDocumentView } from '../alva/BacklogDocumentView'
import { CollapsibleHeader } from '../../components/CollapsibleHeader'
import { useTaskView } from './task-view'
import { TaskArtifacts } from '../claude/TaskArtifacts'
import { Workspace } from '../claude/session-parts'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import { TaskBranchLinks } from './TaskBranchLinks'
import { TaskTimeline } from './TaskTimeline'

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

/**
 * O que mudou no código: resumo da última execução (arquivos, commits, testes), o ambiente da
 * tarefa (editores, diff, limpar) e os documentos para anexar/publicar no Notion.
 */
export function TaskChanges(): React.JSX.Element {
  const { projectId, taskId, card, stages, runs } = useTaskView()
  // A tarefa está na etapa concluída (papel `done`): sugere limpar o ambiente.
  const done = card.stageId !== null && stages.find((s) => s.id === card.stageId)?.role === 'done'
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

/** Aba PR & CI: branch e PR da tarefa e as branches vinculadas à mão. */
export function TaskGitHub(): React.JSX.Element {
  const { projectId, taskId, signals, refreshSignals } = useTaskView()
  return (
    <Section title="GitHub">
      {signals &&
      (signals.localBranches.length > 0 || signals.remoteBranches.length > 0 || signals.pr) ? (
        <TaskSignalsLine signals={signals} />
      ) : (
        <p className="text-xs text-muted-foreground">Sem branch nem PR ainda.</p>
      )}
      <TaskBranchLinks projectId={projectId} taskId={taskId} onChanged={refreshSignals} />
    </Section>
  )
}

/**
 * Aba Detalhes: documentos do Backlog.md, agente, opções e o histórico completo (todos os
 * eventos, recolhido: a sessão já conta o que importa).
 */
export function TaskDetails(): React.JSX.Element {
  const view = useTaskView()
  const { projectId, card, agent, backlog, history, stageName, setBlocked, setAutomationPaused } =
    view
  const [specOpen, setSpecOpen] = useState(false)
  // Aberto já quando a tarefa abre no histórico (sino, notificação).
  const [historyOpen, setHistoryOpen] = useState(view.focusSection === 'history')
  return (
    <div className="flex flex-col gap-6">
      {backlog?.linked && (
        <Section title="Documentos">
          <p className="font-mono text-xs text-muted-foreground" data-testid="alva-task">
            {backlog.task
              ? `Backlog: ${backlog.task.id} · ${backlog.task.status} · critérios ${backlog.task.criteria.done}/${backlog.task.criteria.total}${backlog.task.openQuestions > 0 ? ` · ${plural(backlog.task.openQuestions, 'pergunta em aberto', 'perguntas em aberto')}` : ''}`
              : `Backlog: ${backlog.linked} (arquivo não encontrado na pasta de trabalho)`}
          </p>
          {backlog.task && (
            <Collapsible open={specOpen} onOpenChange={setSpecOpen} className="flex flex-col gap-2">
              <CollapsibleHeader open={specOpen} className="text-sm">
                Spec e plano
              </CollapsibleHeader>
              <CollapsibleContent>{specOpen && <BacklogDocumentView />}</CollapsibleContent>
            </Collapsible>
          )}
        </Section>
      )}

      <TaskAgentSection projectId={projectId} taskId={card.taskId} agent={agent} />

      <Section title="Opções">
        <CheckboxField
          label="Bloqueada"
          checked={card.blocked}
          onChange={(checked) => setBlocked(checked)}
        />
        <CheckboxField
          label="Pausar automações desta tarefa"
          checked={card.automationPaused}
          onChange={(checked) => setAutomationPaused(checked)}
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

      <div ref={view.sectionRef('history')}>
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
    </div>
  )
}

/** "Mover para" na barra da tarefa, com a sincronização com o Notion. */
export function StageSelector(): React.JSX.Element {
  const { card, stages, move } = useTaskView()
  return (
    <div className="flex items-center gap-1.5">
      <SelectField
        className="w-36"
        label="Mover para"
        labelHidden
        size="sm"
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
        value={card.stageId ?? null}
        placeholder="Sem etapa"
        onChange={(value: string) => {
          if (value !== card.stageId) move(value)
        }}
      />
      {card.sync.state === 'pending' && <StatusToken tone="warning" label="Sincronizando" />}
      {card.sync.state === 'pending' && card.sync.message && (
        <p className="text-xs text-muted-foreground">{card.sync.message}</p>
      )}
    </div>
  )
}

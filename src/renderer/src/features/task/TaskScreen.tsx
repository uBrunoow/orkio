import { useEffect } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import { useAgentBadges } from '../agents/agent-badges'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import type { TaskSection } from '../../../../shared/overview'
import { TaskPanel } from './TaskPanel'
import { useBoard } from '../board/useBoard'
import type { ProjectView } from '../../../../shared/projects'

export function TaskScreen({
  project,
  taskId,
  section,
  session,
  onSelectSession,
  onBackToBoard,
  onOpenTerminal
}: {
  project: ProjectView | null
  taskId: string
  section: TaskSection | null
  /** Sessão do Claude Code que a conversa mostra (`null` = a mais recente). */
  session: string | null
  onSelectSession(session: string | null): void
  onBackToBoard(): void
  /** Fase 2: aba Terminal da tarefa. */
  onOpenTerminal?(): void
}): React.JSX.Element {
  const projectId = project?.id ?? null
  const board = useBoard(projectId)
  const signals = useTaskSignals(projectId)
  const agentBadges = useAgentBadges(projectId)
  const refreshSignals = signals.refresh
  const fetchedAt = board.view?.fetchedAt
  useEffect(() => {
    if (fetchedAt) void refreshSignals(false)
  }, [fetchedAt, refreshSignals])

  const card = board.view?.cards.find((c) => c.taskId === taskId) ?? null

  if (!project) {
    return (
      <div className="flex flex-col gap-5 px-8 py-6">
        <PageHeader title="Tarefa" />
        <PageState
          kind="empty"
          title="Projeto não encontrado"
          description="O projeto desta tarefa não está vinculado ao Notion."
          action={{ label: 'Voltar ao quadro', onClick: onBackToBoard }}
        />
      </div>
    )
  }
  if (!board.view) {
    return (
      <div className="px-8 py-6">
        {board.error ? (
          <PageState kind="error" message={board.error.message} />
        ) : (
          <PageState kind="loading" label="Carregando tarefa" />
        )}
      </div>
    )
  }
  if (!card || !board.view.config) {
    return (
      <div className="flex flex-col gap-5 px-8 py-6">
        <PageHeader title="Tarefa" />
        <PageState
          kind="empty"
          title="Tarefa não encontrada"
          description="Ela pode ter saído do projeto no Notion ou do quadro."
          action={{ label: 'Voltar ao quadro', onClick: onBackToBoard }}
        />
      </div>
    )
  }
  return (
    <TaskPanel
      key={`${project.id}:${card.taskId}`}
      projectId={project.id}
      projectName={project.name}
      agent={agentBadges[card.taskId] ?? null}
      card={card}
      stages={board.view.config.stages}
      signals={signals.result?.signals[card.taskId]}
      move={(stageId) => void board.move(card.taskId, stageId)}
      setBlocked={(blocked) => void board.setBlocked(card.taskId, blocked)}
      setAutomationPaused={(paused) => void board.setAutomationPaused(card.taskId, paused)}
      refreshSignals={() => void refreshSignals(true)}
      focusSection={section}
      project={project}
      session={session}
      selectSession={onSelectSession}
      onOpenBoard={onBackToBoard}
      {...(onOpenTerminal ? { openTerminal: onOpenTerminal } : {})}
    />
  )
}

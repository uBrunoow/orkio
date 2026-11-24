import { useEffect } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import { useAgentBadges } from '../agents/agent-badges'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import type { TaskSection } from '../../../../shared/overview'
import { TaskPanel } from '../board/TaskPanel'
import { useBoard } from '../board/useBoard'
import type { ProjectView } from '../../../../shared/projects'

/**
 * Tela da tarefa: fases no topo, conversa no meio e o painel da fase à direita. Abre pela lista
 * lateral, pelo Quadro, pelo sino, pela Command Palette e pelas notificações.
 */
export function TaskScreen({
  project,
  taskId,
  section,
  onBackToBoard
}: {
  project: ProjectView | null
  taskId: string
  section: TaskSection | null
  onBackToBoard(): void
}): React.JSX.Element {
  const projectId = project?.id ?? ''
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
      projectId={project.id}
      agent={agentBadges[card.taskId] ?? null}
      card={card}
      stages={board.view.config.stages}
      signals={signals.result?.signals[card.taskId]}
      onMove={(stageId) => void board.move(card.taskId, stageId)}
      onToggleBlocked={(blocked) => void board.setBlocked(card.taskId, blocked)}
      onToggleAutomation={(paused) => void board.setAutomationPaused(card.taskId, paused)}
      onBranchesChanged={() => void refreshSignals(true)}
      focusSection={section}
      projectName={project.name}
      onOpenBoard={onBackToBoard}
    />
  )
}

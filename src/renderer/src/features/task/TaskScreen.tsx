import { useEffect } from 'react'
import { VStack } from '@astryxdesign/core/VStack'
import type { ProjectView } from '../../../../shared/ipc-contract'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import { useAgentBadges } from '../agents/agent-badges'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import type { TaskSection } from '../../../../shared/overview'
import { TaskPanel } from '../board/TaskPanel'
import { useBoard } from '../board/useBoard'

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
      <VStack gap={5}>
        <PageHeader title="Tarefa" />
        <PageState
          kind="empty"
          title="Projeto não encontrado"
          description="O projeto desta tarefa não está vinculado ao Notion."
          action={{ label: 'Voltar ao quadro', onClick: onBackToBoard }}
        />
      </VStack>
    )
  }
  if (!board.view) {
    return board.error ? (
      <PageState kind="error" message={board.error.message} />
    ) : (
      <PageState kind="loading" label="Carregando tarefa" />
    )
  }
  if (!card || !board.view.config) {
    return (
      <VStack gap={5}>
        <PageHeader title="Tarefa" />
        <PageState
          kind="empty"
          title="Tarefa não encontrada"
          description="Ela pode ter saído do projeto no Notion ou do quadro."
          action={{ label: 'Voltar ao quadro', onClick: onBackToBoard }}
        />
      </VStack>
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
    />
  )
}

import { useEffect } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { VStack } from '@astryxdesign/core/VStack'
import type { ProjectView } from '../../../../shared/ipc-contract'
import { BackIcon } from '../../components/icons'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import { useAgentBadges } from '../agents/agent-badges'
import { useTaskSignals } from '../notion-workspace/useTaskSignals'
import { TaskPanel } from './TaskPanel'
import { useBoard } from './useBoard'

/**
 * Tarefa em tela cheia (6E): o mesmo conteúdo do painel do Quadro com espaço para o log, o
 * briefing e o diff. "Voltar ao quadro" reabre o quadro com o painel desta tarefa.
 */
export function TaskPage({
  project,
  taskId,
  onBackToBoard
}: {
  project: ProjectView | null
  taskId: string
  onBackToBoard(taskId: string | null): void
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
  const back = (
    <Button
      variant="ghost"
      label="Voltar ao quadro"
      icon={<Icon icon={BackIcon} />}
      onClick={() => onBackToBoard(card ? taskId : null)}
    />
  )

  if (!project) {
    return (
      <VStack gap={5}>
        <PageHeader title="Tarefa" action={back} />
        <PageState
          kind="empty"
          title="Projeto não encontrado"
          description="O projeto desta tarefa não está mais vinculado ao Notion."
        />
      </VStack>
    )
  }

  return (
    <VStack gap={5}>
      <PageHeader
        title={card?.title ?? 'Tarefa'}
        context={[card?.displayId, project.name].filter(Boolean).join(' · ')}
        action={back}
      />
      {!board.view ? (
        board.error ? (
          <PageState kind="error" message={board.error.message} />
        ) : (
          <PageState kind="loading" label="Carregando tarefa" />
        )
      ) : !card || !board.view.config ? (
        <PageState
          kind="empty"
          title="Tarefa não encontrada"
          description="Ela pode ter saído do projeto no Notion ou do quadro."
          action={{ label: 'Voltar ao quadro', onClick: () => onBackToBoard(null) }}
        />
      ) : (
        <TaskPanel
          variant="page"
          projectId={project.id}
          agent={agentBadges[card.taskId] ?? null}
          card={card}
          stages={board.view.config.stages}
          signals={signals.result?.signals[card.taskId]}
          onMove={(stageId) => void board.move(card.taskId, stageId)}
          onToggleBlocked={(blocked) => void board.setBlocked(card.taskId, blocked)}
          onToggleAutomation={(paused) => void board.setAutomationPaused(card.taskId, paused)}
          onClose={() => onBackToBoard(card.taskId)}
        />
      )}
    </VStack>
  )
}

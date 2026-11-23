import { useState } from 'react'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { VStack } from '@astryxdesign/core/VStack'
import type { BoardView, ProjectView } from '../../../../shared/ipc-contract'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
/** Abas de Fluxos (até a Tarefa 9 juntar tudo em Quadro e automações). */
type FlowsTab = 'flows' | 'alva'
import { AlvaPage } from '../alva/AlvaPage'
import { TaskFlowsPage } from '../task-flows/TaskFlowsPage'
import { BoardSettings } from './BoardSettings'
import { FlowPage } from './FlowPage'
import { useBoard, type UseBoard } from './useBoard'

type ConfiguredView = BoardView & { config: NonNullable<BoardView['config']> }

/**
 * Telas por projeto além do Quadro (6E): Etapas e automações (3C), Fluxos (5A + Modelos Alva da
 * 5B) e Contexto do Claude (4B). Cada uma tem o próprio h1; o projeto atual vem do menu.
 */

function NoProject({ onOpenProjects }: { onOpenProjects(): void }): React.JSX.Element {
  return (
    <PageState
      kind="empty"
      title="Nenhum projeto vinculado ao Notion"
      description="Vincule um projeto a um projeto do Notion em Projetos."
      action={{ label: 'Ir para Projetos', onClick: onOpenProjects }}
    />
  )
}

/** Carrega o quadro do projeto e mostra carregando/erro/sem quadro de um jeito só. */
function WithBoard({
  projectId,
  onOpenBoard,
  header,
  children
}: {
  projectId: string
  onOpenBoard(): void
  /** Cabeçalho mostrado nos estados de carregando/erro/sem quadro (quando a tela o desenha). */
  header?: React.ReactNode
  children(view: ConfiguredView, board: UseBoard): React.ReactNode
}): React.JSX.Element {
  const board = useBoard(projectId)
  const withHeader = (node: React.ReactNode): React.JSX.Element =>
    header ? (
      <VStack gap={5}>
        {header}
        {node}
      </VStack>
    ) : (
      <>{node}</>
    )
  if (!board.view) {
    return withHeader(
      board.error ? (
        <PageState kind="error" message={board.error.message} />
      ) : (
        <PageState kind="loading" label="Carregando quadro" />
      )
    )
  }
  if (!board.view.config) {
    return withHeader(
      <PageState
        kind="empty"
        title="Crie o quadro primeiro"
        description="As etapas, automações e fluxos ficam disponíveis depois de criar o quadro do projeto."
        action={{ label: 'Ir para o Quadro', onClick: onOpenBoard }}
      />
    )
  }
  return <>{children(board.view as ConfiguredView, board)}</>
}

export function AutomationsPage({
  project,
  onOpenBoard,
  onOpenFlows,
  onOpenProjects
}: {
  project: ProjectView | null
  onOpenBoard(): void
  onOpenFlows(): void
  onOpenProjects(): void
}): React.JSX.Element {
  const [notionSettings, setNotionSettings] = useState(false)
  const header = (action?: React.ReactNode): React.JSX.Element => (
    <PageHeader
      title="Etapas e automações"
      {...(project ? { context: project.name } : {})}
      subtitle="Cada etapa corresponde a uma opção do status das Tarefas no Notion. As automações levam a tarefa para a etapa. Nada muda até você salvar."
      action={action}
    />
  )
  if (!project) {
    return (
      <VStack gap={5}>
        {header()}
        <NoProject onOpenProjects={onOpenProjects} />
      </VStack>
    )
  }
  return (
    <WithBoard projectId={project.id} onOpenBoard={onOpenBoard} header={header()}>
      {(view, board) =>
        notionSettings ? (
          <VStack gap={5}>
            {header()}
            <BoardSettings
              view={view}
              onSave={async (input) => {
                const result = await board.save(input)
                if (result.ok) setNotionSettings(false)
                return result
              }}
              onCancel={() => setNotionSettings(false)}
            />
          </VStack>
        ) : (
          <FlowPage
            view={view}
            header={header}
            onSaved={(next) => {
              board.replace(next)
              onOpenBoard()
            }}
            onOpenNotionSettings={() => setNotionSettings(true)}
            onOpenTaskFlows={onOpenFlows}
          />
        )
      }
    </WithBoard>
  )
}

export function FlowsPage({
  project,
  tab,
  onTabChange,
  onOpenBoard,
  onOpenProjects
}: {
  project: ProjectView | null
  tab: FlowsTab
  onTabChange(tab: FlowsTab): void
  onOpenBoard(): void
  onOpenProjects(): void
}): React.JSX.Element {
  return (
    <VStack gap={5}>
      <PageHeader
        title="Fluxos"
        {...(project ? { context: project.name } : {})}
        subtitle="Sequências de passos (comandos do Claude Code, aprovações, ações do Orkio) que rodam numa tarefa."
      />
      {!project ? (
        <NoProject onOpenProjects={onOpenProjects} />
      ) : (
        <>
          <TabList
            value={tab}
            onChange={(value) => onTabChange(value === 'alva' ? 'alva' : 'flows')}
            hasDivider
            role="tablist"
            aria-label="Seções de Fluxos"
          >
            <Tab value="flows" label="Fluxos do projeto" />
            <Tab value="alva" label="Modelos do alva-flow" />
          </TabList>
          {tab === 'flows' ? (
            <TaskFlowsPage key={project.id} projectId={project.id} />
          ) : (
            <WithBoard projectId={project.id} onOpenBoard={onOpenBoard}>
              {(view, board) => (
                <AlvaPage
                  projectId={project.id}
                  view={view}
                  onBoardChanged={() => void board.load(true)}
                />
              )}
            </WithBoard>
          )}
        </>
      )}
    </VStack>
  )
}

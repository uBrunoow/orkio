import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { PageState } from '../../components/PageState'
import type { BoardSettingsTab } from '../../app/routes'
import { AlvaPage } from '../alva/AlvaPage'
import { TaskFlowsPage } from '../task-flows/TaskFlowsPage'
import { BoardSettings } from './BoardSettings'
import { FlowPage } from './FlowPage'
import { useBoard, type UseBoard } from './useBoard'
import type { BoardView } from '../../../../shared/board'
import type { ProjectView } from '../../../../shared/projects'

type ConfiguredView = BoardView & { config: NonNullable<BoardView['config']> }

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
      <div className="flex flex-col gap-5">
        {header}
        {node}
      </div>
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

/**
 * Configurações › Quadro e automações: abas Colunas · Automações · Fluxos · Entrega sobre o mesmo
 * rascunho do fluxo do projeto (3C), com os fluxos de tarefa (5A) e os modelos do alva-flow (5B).
 */
export function BoardSettingsPage({
  project,
  tab,
  onTabChange,
  onOpenBoard,
  onOpenProjects
}: {
  project: ProjectView | null
  tab: BoardSettingsTab
  onTabChange(tab: BoardSettingsTab): void
  onOpenBoard(): void
  onOpenProjects(): void
}): React.JSX.Element {
  const [notionSettings, setNotionSettings] = useState(false)
  const header = (action?: React.ReactNode): React.JSX.Element => (
    <PageHeader
      title="Quadro e automações"
      subtitle="As colunas do quadro e o que o Orkio faz sozinho quando algo acontece no GitHub. Nada muda até você salvar."
      action={action}
    />
  )
  if (!project) {
    return (
      <div className="flex flex-col gap-5">
        {header()}
        <NoProject onOpenProjects={onOpenProjects} />
      </div>
    )
  }
  return (
    <WithBoard projectId={project.id} onOpenBoard={onOpenBoard} header={header()}>
      {(view, board) =>
        notionSettings ? (
          <div className="flex flex-col gap-5">
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
          </div>
        ) : (
          <FlowPage
            view={view}
            header={header}
            tab={tab}
            onTabChange={onTabChange}
            onSaved={(next) => board.replace(next)}
            onOpenNotionSettings={() => setNotionSettings(true)}
            onOpenTaskFlows={() => onTabChange('flows')}
            flowsSlot={
              <div className="flex flex-col gap-6">
                <TaskFlowsPage key={project.id} projectId={project.id} />
                <section aria-label="Modelos do alva-flow" className="flex flex-col gap-3">
                  <h2 className="text-base font-medium">Modelos do alva-flow</h2>
                  <AlvaPage
                    projectId={project.id}
                    view={view}
                    onBoardChanged={() => void board.load(true)}
                  />
                </section>
              </div>
            }
          />
        )
      }
    </WithBoard>
  )
}

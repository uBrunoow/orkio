/**
 * Checagens de um projeto (Configurações › Projetos): pasta e git, GitHub, página do Notion e
 * quadro. Puro.
 */
import { plural } from '../../lib/format'
import { PROJECT_HEALTH } from '../../lib/status-text'
import { isFolderProblem, type ProjectView } from '../../../../shared/projects'

export type CheckId = 'folder' | 'github' | 'notion' | 'board'

export interface ProjectCheck {
  id: CheckId
  label: string
  state: 'ok' | 'warning' | 'problem'
}

export function projectChecks(input: {
  project: ProjectView
  /** Colunas do quadro; `null` = quadro ainda não criado. */
  boardStages: number | null
}): ProjectCheck[] {
  const { project, boardStages } = input
  const folder = project.health.state
  return [
    isFolderProblem(folder)
      ? { id: 'folder', label: PROJECT_HEALTH[folder].label, state: 'problem' }
      : { id: 'folder', label: 'Pasta e git', state: 'ok' },
    !project.repo
      ? { id: 'github', label: 'Sem repositório no GitHub', state: 'warning' }
      : project.repo.canPush === false
        ? { id: 'github', label: 'GitHub sem permissão de push', state: 'warning' }
        : { id: 'github', label: 'GitHub (push)', state: 'ok' },
    project.notionProject
      ? { id: 'notion', label: `Notion: página "${project.notionProject.name}"`, state: 'ok' }
      : { id: 'notion', label: 'Sem página no Notion', state: 'warning' },
    boardStages === null
      ? { id: 'board', label: 'Sem quadro', state: 'warning' }
      : { id: 'board', label: `Quadro: ${plural(boardStages, 'coluna', 'colunas')}`, state: 'ok' }
  ]
}

/** Passos do setup que o projeto ainda deve (página do Notion e quadro). */
export function missingSteps(checks: readonly ProjectCheck[]): number {
  return checks.filter((c) => (c.id === 'notion' || c.id === 'board') && c.state !== 'ok').length
}

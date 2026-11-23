/**
 * Checagens de um projeto (Configurações › Projetos): pasta e git, GitHub, página do Notion,
 * quadro e, com a pré-checagem do alva-flow, plugin e gh. Puro.
 */
import type { AlvaPrecheck } from '../../../../shared/alva'
import type { ProjectView } from '../../../../shared/ipc-contract'
import { plural } from '../../lib/format'

export type CheckId = 'folder' | 'github' | 'notion' | 'board' | 'alva' | 'gh'

export interface ProjectCheck {
  id: CheckId
  label: string
  state: 'ok' | 'warning' | 'problem'
}

export function projectChecks(input: {
  project: ProjectView
  /** Colunas do quadro; `null` = quadro ainda não criado. */
  boardStages: number | null
  precheck: AlvaPrecheck | null
}): ProjectCheck[] {
  const { project, boardStages, precheck } = input
  const checks: ProjectCheck[] = [
    project.local === null
      ? { id: 'folder', label: 'Pasta não encontrada', state: 'problem' }
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
  if (precheck) {
    checks.push({ id: 'alva', label: 'alva-flow', state: precheck.ready ? 'ok' : 'warning' })
    const gh = precheck.items.find((i) => i.id === 'gh')
    if (gh) {
      checks.push({
        id: 'gh',
        label: gh.state === 'ok' ? 'gh' : `gh: ${gh.detail}`,
        state: gh.state === 'ok' ? 'ok' : 'warning'
      })
    }
  }
  return checks
}

/** Passos do setup que o projeto ainda deve (página do Notion e quadro). */
export function missingSteps(checks: readonly ProjectCheck[]): number {
  return checks.filter((c) => (c.id === 'notion' || c.id === 'board') && c.state !== 'ok').length
}

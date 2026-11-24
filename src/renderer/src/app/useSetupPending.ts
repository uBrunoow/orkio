import { setupPending, setupSteps } from '../features/setup/setup-steps'
import { useConnectionStatus } from '../features/integrations/useConnection'
import { useClaudeStatus } from '../features/claude/useClaudeStatus'
import { useNotionWorkspace } from '../features/notion-workspace/useNotionWorkspace'
import type { BoardView } from '../../../shared/board'
import type { ProjectView } from '../../../shared/projects'

/**
 * Quantos passos dos Primeiros passos faltam para o projeto atual (aviso no topo da lista lateral).
 * Conexões, Claude Code e bancos do Notion vêm das fontes do App (o que muda em Integrações ou nos
 * Primeiros passos já aparece aqui).
 */
export function useSetupPending(project: ProjectView | null, board: BoardView | null): number {
  const github = useConnectionStatus('github')
  const notion = useConnectionStatus('notion')
  const claude = useClaudeStatus().status
  const workspace = useNotionWorkspace().status
  if (!project || github === null || notion === null || claude === null) return 0
  return setupPending(
    setupSteps({
      github,
      notion,
      claude,
      project,
      workspace,
      boardConfigured: project.notionProject ? (board ? !!board.config : true) : false
    })
  )
}

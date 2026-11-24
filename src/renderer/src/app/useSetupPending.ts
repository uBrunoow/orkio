import { setupPending, setupSteps } from '../features/setup/setup-steps'
import { useConnectionStatus } from '../features/integrations/useConnection'
import { useClaudeStatus } from '../features/claude/useClaudeStatus'
import { useIpcResource } from '../lib/ipc'
import type { BoardView } from '../../../shared/board'
import type { ProjectView } from '../../../shared/projects'

/**
 * Quantos passos dos Primeiros passos faltam para o projeto atual (aviso no topo da lista lateral).
 * Conexões e Claude Code vêm das fontes do App; os bancos do Notion são relidos quando o projeto
 * ou o vínculo mudam e quando a janela volta ao foco.
 */
export function useSetupPending(project: ProjectView | null, board: BoardView | null): number {
  const github = useConnectionStatus('github')
  const notion = useConnectionStatus('notion')
  const claude = useClaudeStatus().status
  const workspace = useIpcResource(
    project ? `${project.id}:${project.notionProject?.id ?? ''}` : null,
    () => window.orkio.notionWorkspace.getStatus(),
    { refreshOnFocus: true }
  ).value
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

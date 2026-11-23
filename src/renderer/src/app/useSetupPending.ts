import { useEffect, useState } from 'react'
import type { ClaudeCodeStatus } from '../../../shared/agent-run'
import type {
  BoardView,
  ConnectionStatus,
  NotionWorkspaceStatus,
  ProjectView
} from '../../../shared/ipc-contract'
import { setupPending, setupSteps } from '../features/setup/setup-steps'

/**
 * Quantos passos dos Primeiros passos faltam para o projeto atual (aviso no topo da lista lateral).
 * Lê o estado ao abrir e quando a janela volta ao foco; nada é guardado.
 */
export function useSetupPending(project: ProjectView | null, board: BoardView | null): number {
  const [state, setState] = useState<{
    notion: ConnectionStatus | null
    claude: ClaudeCodeStatus | null
    workspace: NotionWorkspaceStatus | null
  } | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void Promise.all([
        window.orkio.notion.getStatus().catch(() => null),
        window.orkio.claude.status().catch(() => null),
        window.orkio.notionWorkspace.getStatus().catch(() => null)
      ]).then(([notion, claude, workspace]) => {
        if (alive) setState({ notion, claude, workspace })
      })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [])
  if (!state || !project) return 0
  return setupPending(
    setupSteps({
      github: null,
      githubSkipped: true,
      notion: state.notion,
      claude: state.claude,
      project,
      workspace: state.workspace,
      boardConfigured: project.notionProject ? (board ? !!board.config : true) : false
    })
  )
}

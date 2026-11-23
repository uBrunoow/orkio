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
 * Lê o estado ao abrir, quando o projeto/vínculo muda e quando a janela volta ao foco.
 */
export function useSetupPending(project: ProjectView | null, board: BoardView | null): number {
  const projectId = project?.id ?? null
  const notionPageId = project?.notionProject?.id ?? null
  const [state, setState] = useState<{
    github: ConnectionStatus | null
    notion: ConnectionStatus | null
    claude: ClaudeCodeStatus | null
    workspace: NotionWorkspaceStatus | null
  } | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void Promise.all([
        window.orkio.github.getStatus().catch(() => null),
        window.orkio.notion.getStatus().catch(() => null),
        window.orkio.claude.status().catch(() => null),
        window.orkio.notionWorkspace.getStatus().catch(() => null)
      ]).then(([github, notion, claude, workspace]) => {
        if (alive) setState({ github, notion, claude, workspace })
      })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
    // Relê quando o projeto ou o vínculo mudam (ex.: ao sair dos Primeiros passos no meio).
  }, [projectId, notionPageId])
  if (!state || !project) return 0
  return setupPending(
    setupSteps({
      github: state.github,
      notion: state.notion,
      claude: state.claude,
      project,
      workspace: state.workspace,
      boardConfigured: project.notionProject ? (board ? !!board.config : true) : false
    })
  )
}

import type { ORKIO_API } from '../../shared/ipc/api'
import { PROJECT_TERMINAL_TASK } from '../../shared/terminal'
import type { TerminalService } from '../terminal/terminal.service'
import type { Impl } from './register'

/**
 * Terminal embutido (Fase 2). A pasta vem do worktree da tarefa (main); o renderer só passa ids.
 * Só o shell abre por aqui: o Claude no terminal é o "Continuar no Claude" (`claude.*`).
 */
export function terminalHandlers(deps: {
  terminals: TerminalService
  hasProject(projectId: string): boolean
  worktreePath(taskId: string): string | null
  /** Pasta local do projeto (`null` = projeto não existe). */
  projectPath(projectId: string): string | null
}): Impl<typeof ORKIO_API.terminal> {
  const { terminals } = deps
  return {
    list: async (projectId, taskId) => {
      return {
        ok: true,
        value: {
          available: terminals.available,
          terminals: terminals.list(taskId).filter((t) => t.projectId === projectId)
        }
      }
    },
    all: async () => ({
      ok: true,
      value: {
        available: terminals.available,
        terminals: terminals.all().filter((t) => deps.hasProject(t.projectId))
      }
    }),
    openInProject: async (projectId) => {
      const cwd = deps.projectPath(projectId)
      if (!cwd) {
        return {
          ok: false,
          error: { code: 'no_project', message: 'Projeto não encontrado. Escolha outro projeto.' }
        }
      }
      return {
        ok: true,
        value: terminals.open({ projectId, taskId: PROJECT_TERMINAL_TASK, cwd, kind: 'shell' })
      }
    },
    open: async (projectId, taskId) => {
      const cwd = deps.hasProject(projectId) ? deps.worktreePath(taskId) : null
      if (!cwd) {
        return {
          ok: false,
          error: {
            code: 'no_workspace',
            message: 'Esta tarefa ainda não tem pasta de trabalho. Rode o Claude Code primeiro.'
          }
        }
      }
      return { ok: true, value: terminals.open({ projectId, taskId, cwd, kind: 'shell' }) }
    },
    snapshot: async (id) => terminals.snapshot(id),
    write: async (id, data) => terminals.write(id, data),
    resize: async (id, size) => terminals.resize(id, size),
    close: (id) => terminals.close(id)
  }
}

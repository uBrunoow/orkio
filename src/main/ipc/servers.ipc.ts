import type { ORKIO_API } from '../../shared/ipc/api'
import type { ServersService } from '../servers/servers.service'
import type { Impl } from './register'

const NO_PROJECT = { code: 'no_project', message: 'Projeto não encontrado. Escolha outro projeto.' }

/**
 * Servidores da tarefa. O renderer só passa ids: o comando vem do cadastro, a pasta do worktree e a
 * URL aberta é montada aqui (só a do servidor de pé desta tarefa, sempre em localhost).
 */
export function serversHandlers(deps: {
  servers: ServersService
  hasProject(projectId: string): boolean
  openExternal(url: string): Promise<void>
}): Impl<typeof ORKIO_API.servers> {
  const { servers } = deps
  return {
    defs: async (projectId) =>
      deps.hasProject(projectId)
        ? { ok: true, value: servers.defs(projectId) }
        : { ok: false, error: NO_PROJECT },
    save: async (projectId, defs) =>
      deps.hasProject(projectId)
        ? { ok: true, value: await servers.save(projectId, defs) }
        : { ok: false, error: NO_PROJECT },
    list: async (projectId, taskId) =>
      deps.hasProject(projectId)
        ? {
            ok: true,
            value: { available: servers.available, servers: servers.list(projectId, taskId) }
          }
        : { ok: false, error: NO_PROJECT },
    start: async (projectId, taskId, serverId) =>
      deps.hasProject(projectId)
        ? { ok: true, value: await servers.start(projectId, taskId, serverId, 'you') }
        : { ok: false, error: NO_PROJECT },
    stop: async (projectId, taskId, serverId) =>
      deps.hasProject(projectId)
        ? { ok: true, value: await servers.stop(projectId, taskId, serverId, 'you') }
        : { ok: false, error: NO_PROJECT },
    open: async (projectId, taskId, serverId) => {
      const url = deps.hasProject(projectId) ? servers.urlOf(projectId, taskId, serverId) : null
      if (!url || !/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}(\/|$)/.test(url)) {
        return {
          ok: false,
          error: { code: 'not_running', message: 'Suba o servidor antes de abrir no navegador.' }
        }
      }
      await deps.openExternal(url)
      return { ok: true, value: null }
    }
  }
}

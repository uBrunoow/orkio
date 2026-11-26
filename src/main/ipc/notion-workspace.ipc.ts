import type { ORKIO_API } from '../../shared/ipc/api'
import type { NotionWorkspaceService } from '../notion/notion-workspace.service'
import type { Impl } from './register'

/** Bancos do Notion: o renderer manda só ids (do Notion e de projetos locais). Nada é salvo do conteúdo. */
export function notionWorkspaceHandlers(
  service: Pick<
    NotionWorkspaceService,
    | 'getStatus'
    | 'revalidate'
    | 'listDataSources'
    | 'getTasksSchema'
    | 'saveConfig'
    | 'getGitFlow'
    | 'saveGitFlow'
    | 'listProjectChoices'
    | 'link'
    | 'unlink'
    | 'listTasks'
    | 'searchTasks'
  >
): Impl<typeof ORKIO_API.notionWorkspace> {
  return {
    getStatus: () => service.getStatus(),
    revalidate: () => service.revalidate(),
    listDataSources: (query) => service.listDataSources(query),
    getTasksSchema: (tasks, projects) => service.getTasksSchema(tasks, projects),
    save: (input) => service.saveConfig(input),
    getGitFlow: () => service.getGitFlow(),
    saveGitFlow: (input) => service.saveGitFlow(input),
    listProjectChoices: (projectId, options) => service.listProjectChoices(projectId, options),
    link: (projectId, pageId) => service.link(projectId, pageId),
    unlink: (projectId) => service.unlink(projectId),
    listTasks: (projectId, options) => service.listTasks(projectId, options),
    searchTasks: (query) => service.searchTasks(query)
  }
}

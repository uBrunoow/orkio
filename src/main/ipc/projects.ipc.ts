import type { ORKIO_API } from '../../shared/ipc/api'
import type { ProjectsService } from '../projects/projects.service'
import type { Impl } from './register'

/**
 * Projetos. O renderer NUNCA manda caminhos: só ids de projeto e o `selectionId` emitido pelo main
 * depois do seletor de pasta.
 */
export function projectsHandlers(
  service: Pick<
    ProjectsService,
    'list' | 'revalidate' | 'pickFolder' | 'create' | 'relocate' | 'remove' | 'setArchived'
  >
): Impl<typeof ORKIO_API.projects> {
  return {
    list: () => service.list(),
    revalidate: () => service.revalidate(),
    pickFolder: () => service.pickFolder(),
    create: (input) => service.create(input),
    relocate: (projectId) => service.relocate(projectId),
    remove: (projectId) => service.remove(projectId),
    setArchived: (projectId, archived) => service.setArchived(projectId, archived)
  }
}

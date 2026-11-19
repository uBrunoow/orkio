import type { IpcMain } from 'electron'
import {
  IPC_CHANNELS,
  type CreateProjectInput,
  type PickFolderResult,
  type ProjectMutationResult,
  type ProjectsListResult
} from '../../shared/ipc-contract'
import type { ProjectsService } from '../projects/projects.service'
import { errorName } from './payload'
import type { SenderGuard } from './trusted-sender'

const GENERIC_ERROR = {
  code: 'git_error' as const,
  message: 'Algo deu errado com os projetos. Tente novamente.'
}

/**
 * Handlers de Projetos. O renderer NUNCA manda caminhos: só ids de projeto e o `selectionId`
 * emitido pelo main depois do seletor de pasta.
 */
export function registerProjectsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: Pick<
    ProjectsService,
    'list' | 'revalidate' | 'pickFolder' | 'create' | 'relocate' | 'remove'
  >,
  isTrustedSender: SenderGuard,
  ready: Promise<void> = Promise.resolve()
): void {
  const { projects } = IPC_CHANNELS

  function guarded<T>(channel: string, fallback: T, run: (payload: unknown) => Promise<T>): void {
    ipc.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Origem de IPC não autorizada')
      try {
        await ready
        return await run(payload)
      } catch (error) {
        console.error(`[orkio] falha inesperada em ${channel}: ${errorName(error)}`)
        return fallback
      }
    })
  }

  const listFallback: ProjectsListResult = {
    projects: [],
    warning: 'Não foi possível carregar os projetos.'
  }
  const mutationFallback: ProjectMutationResult = {
    ok: false,
    cancelled: false,
    error: GENERIC_ERROR
  }
  const invalid = (message: string): ProjectMutationResult => ({
    ok: false,
    cancelled: false,
    error: { code: 'project_not_found', message }
  })

  guarded(projects.list, listFallback, () => service.list())
  guarded(projects.revalidate, listFallback, () => service.revalidate())
  guarded<PickFolderResult>(
    projects.pickFolder,
    { ok: false, cancelled: false, error: GENERIC_ERROR },
    () => service.pickFolder()
  )
  guarded(projects.create, mutationFallback, async (payload) =>
    isCreateInput(payload)
      ? service.create(payload)
      : invalid('Dados inválidos para criar o projeto.')
  )
  guarded(projects.relocate, mutationFallback, async (payload) =>
    isId(payload) ? service.relocate(payload) : invalid('Projeto inválido.')
  )
  guarded(projects.remove, { ok: false }, async (payload) =>
    isId(payload) ? service.remove(payload) : { ok: false }
  )
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value)
}

export function isCreateInput(value: unknown): value is CreateProjectInput {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isId(v['selectionId']) &&
    typeof v['remoteName'] === 'string' &&
    v['remoteName'].length > 0 &&
    v['remoteName'].length <= 100 &&
    typeof v['hostConfirmed'] === 'boolean' &&
    (v['name'] === undefined || (typeof v['name'] === 'string' && v['name'].length <= 200))
  )
}

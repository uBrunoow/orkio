import { useCallback, useEffect, useRef, useState } from 'react'
import { useSources } from '../../app/sources'
import { IPC_FAILURE_MESSAGE, ipcCall, useSource } from '../../lib/ipc'
import type {
  CreateProjectInput,
  PickFolderResult,
  ProjectMutationResult,
  ProjectView
} from '../../../../shared/projects'

export interface UseProjects {
  /** `null` enquanto carrega pela primeira vez. */
  projects: ProjectView[] | null
  /** Revalidando no GitHub em segundo plano. */
  revalidating: boolean
  warning: string | null
  pickFolder(): Promise<PickFolderResult>
  create(input: CreateProjectInput): Promise<ProjectMutationResult>
  relocate(projectId: string): Promise<ProjectMutationResult>
  remove(projectId: string): Promise<boolean>
  /** Arquiva/desarquiva (nada é apagado). */
  setArchived(projectId: string, archived: boolean): Promise<boolean>
  refresh(): Promise<void>
}

const MUTATION_FAILURE = {
  ok: false,
  cancelled: false,
  error: { code: 'git_error', message: IPC_FAILURE_MESSAGE }
} as const

/**
 * Lista de projetos, uma só para o App (menu, lista lateral, Agentes, Projetos, Primeiros passos):
 * branch ao vivo, estado local ao voltar para a janela. Com `revalidate`, ao abrir a tela confere
 * também no GitHub (Projetos, Primeiros passos).
 */
export function useProjects({ revalidate = false }: { revalidate?: boolean } = {}): UseProjects {
  const { projects: source } = useSources()
  const state = useSource(source, '')
  const [revalidating, setRevalidating] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    setRevalidating(true)
    await source.reload('', 'revalidate')
    if (mounted.current) setRevalidating(false)
  }, [source])

  useEffect(() => {
    mounted.current = true
    if (revalidate) {
      void (async () => {
        await source.reload('')
        if (mounted.current) await refresh()
      })()
    }
    return () => {
      mounted.current = false
    }
  }, [revalidate, source, refresh])

  const upsert = useCallback(
    (project: ProjectView) =>
      source.set('', (s) => {
        const list = s?.projects ?? []
        return {
          warning: s?.warning ?? null,
          projects: list.some((p) => p.id === project.id)
            ? list.map((p) => (p.id === project.id ? project : p))
            : [...list, project]
        }
      }),
    [source]
  )

  const mutate = useCallback(
    async (run: () => Promise<ProjectMutationResult>): Promise<ProjectMutationResult> => {
      const result = await ipcCall(run, MUTATION_FAILURE)
      if (result.ok) upsert(result.project)
      return result
    },
    [upsert]
  )

  return {
    projects: state.value?.projects ?? (state.error ? [] : null),
    revalidating,
    warning: state.error ? state.error.message : (state.value?.warning ?? null),
    pickFolder: () => ipcCall(() => window.orkio.projects.pickFolder(), MUTATION_FAILURE),
    create: (input) => mutate(() => window.orkio.projects.create(input)),
    relocate: (projectId) => mutate(() => window.orkio.projects.relocate(projectId)),
    remove: async (projectId) => {
      const { ok } = await ipcCall(() => window.orkio.projects.remove(projectId), { ok: false })
      if (ok) {
        source.set('', (s) =>
          s ? { ...s, projects: s.projects.filter((p) => p.id !== projectId) } : s
        )
      }
      return ok
    },
    setArchived: async (projectId, archived) => {
      const { ok } = await ipcCall(() => window.orkio.projects.setArchived(projectId, archived), {
        ok: false
      })
      if (ok) {
        source.set('', (s) =>
          s
            ? {
                ...s,
                projects: s.projects.map((p) => (p.id === projectId ? { ...p, archived } : p))
              }
            : s
        )
      }
      return ok
    },
    refresh
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
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
  refresh(): Promise<void>
}

const IPC_FAILURE = 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'

export function useProjects(): UseProjects {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const [revalidating, setRevalidating] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (kind: 'list' | 'revalidate') => {
    try {
      const result = await window.orkio.projects[kind]()
      if (!mounted.current) return
      setProjects(result.projects)
      setWarning(result.warning ?? null)
    } catch {
      if (mounted.current) {
        setProjects((current) => current ?? [])
        setWarning(IPC_FAILURE)
      }
    }
  }, [])

  // Ao abrir: lista local rápida e, em seguida, revalidação no GitHub.
  useEffect(() => {
    mounted.current = true
    void (async () => {
      await load('list')
      if (!mounted.current) return
      setRevalidating(true)
      await load('revalidate')
      if (mounted.current) setRevalidating(false)
    })()
    return () => {
      mounted.current = false
    }
  }, [load])

  // Branch ao vivo (evento do main) e estado local ao voltar para a janela.
  useEffect(() => {
    const unsubscribe = window.orkio.projects.onBranchChanged(({ projectId, branch }) => {
      setProjects(
        (current) =>
          current?.map((p) =>
            p.id === projectId && p.local ? { ...p, local: { ...p.local, branch } } : p
          ) ?? current
      )
    })
    const onFocus = (): void => void load('list')
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const upsert = useCallback((project: ProjectView) => {
    setProjects((current) => {
      const list = current ?? []
      return list.some((p) => p.id === project.id)
        ? list.map((p) => (p.id === project.id ? project : p))
        : [...list, project]
    })
  }, [])

  const pickFolder = useCallback(async (): Promise<PickFolderResult> => {
    try {
      return await window.orkio.projects.pickFolder()
    } catch {
      return { ok: false, cancelled: false, error: { code: 'git_error', message: IPC_FAILURE } }
    }
  }, [])

  const mutate = useCallback(
    async (run: () => Promise<ProjectMutationResult>): Promise<ProjectMutationResult> => {
      let result: ProjectMutationResult
      try {
        result = await run()
      } catch {
        result = { ok: false, cancelled: false, error: { code: 'git_error', message: IPC_FAILURE } }
      }
      if (result.ok && mounted.current) upsert(result.project)
      return result
    },
    [upsert]
  )

  const create = useCallback(
    (input: CreateProjectInput) => mutate(() => window.orkio.projects.create(input)),
    [mutate]
  )
  const relocate = useCallback(
    (projectId: string) => mutate(() => window.orkio.projects.relocate(projectId)),
    [mutate]
  )

  const remove = useCallback(async (projectId: string): Promise<boolean> => {
    const { ok } = await window.orkio.projects.remove(projectId).catch(() => ({ ok: false }))
    if (ok && mounted.current) {
      setProjects((current) => current?.filter((p) => p.id !== projectId) ?? current)
    }
    return ok
  }, [])

  const refresh = useCallback(async () => {
    setRevalidating(true)
    await load('revalidate')
    if (mounted.current) setRevalidating(false)
  }, [load])

  return { projects, revalidating, warning, pickFolder, create, relocate, remove, refresh }
}

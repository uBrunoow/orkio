import { catalogKey, useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import type { CatalogGroup } from '../../../../shared/agent-run'

/**
 * Catálogo do Claude Code (comandos do usuário, do projeto e dos plugins), compartilhado: na
 * tarefa (pasta do worktree) ou, sem tarefa, na pasta do projeto. `projectId` `null` = não lê.
 * Falha = vazio. `reload` ("Recarregar") lê de novo.
 */
export function useCatalog(
  projectId: string | null,
  taskId: string | null
): { groups: CatalogGroup[] | null; loading: boolean; reload(): Promise<void> } {
  const { catalog } = useSources()
  const key = projectId === null ? null : catalogKey(projectId, taskId)
  const state = useSource(catalog, key)
  return {
    groups: state.value,
    loading: state.loading,
    reload: () => (key === null ? Promise.resolve() : catalog.reload(key))
  }
}

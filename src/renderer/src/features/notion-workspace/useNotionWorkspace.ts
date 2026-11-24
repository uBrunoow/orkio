import { useCallback, useEffect, useRef, useState } from 'react'
import { useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import type { NotionWorkspaceStatus } from '../../../../shared/notion'

export interface UseNotionWorkspace {
  /** `null` enquanto carrega. */
  status: NotionWorkspaceStatus | null
  revalidating: boolean
  revalidate(): Promise<void>
  setStatus(status: NotionWorkspaceStatus): void
}

/**
 * Estado dos bancos do Notion, um para o App (Integrações, Primeiros passos, Projetos e o
 * "Falta N passos" da lista lateral). `refreshKey` muda quando a conexão do Notion muda
 * (conectou/desconectou): aí revalidamos o schema no main. `null` = ainda carregando; espera.
 */
export function useNotionWorkspace(refreshKey: string | null = 'static'): UseNotionWorkspace {
  const { notionWorkspace } = useSources()
  const status = useSource(notionWorkspace, '').value
  const [revalidating, setRevalidating] = useState(false)
  const mounted = useRef(true)
  const first = useRef(true)

  const revalidate = useCallback(async () => {
    setRevalidating(true)
    await notionWorkspace.reload('', 'revalidate')
    if (mounted.current) setRevalidating(false)
  }, [notionWorkspace])

  useEffect(() => {
    mounted.current = true
    if (refreshKey !== null) {
      // Ao abrir: o estado do main (que revalida uma vez por sessão); depois, cada mudança de
      // conexão revalida o schema.
      void (first.current ? notionWorkspace.reload('') : revalidate())
      first.current = false
    }
    return () => {
      mounted.current = false
    }
  }, [refreshKey, revalidate, notionWorkspace])

  const setStatus = useCallback(
    (next: NotionWorkspaceStatus) => notionWorkspace.set('', next),
    [notionWorkspace]
  )

  return { status, revalidating, revalidate, setStatus }
}

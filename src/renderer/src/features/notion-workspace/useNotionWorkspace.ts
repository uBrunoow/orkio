import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotionWorkspaceStatus } from '../../../../shared/notion'

const IPC_FAILURE: NotionWorkspaceStatus = {
  config: null,
  health: 'unverified',
  messages: ['Não foi possível falar com o processo principal do Orkio. Reinicie o app.'],
  connection: null
}

export interface UseNotionWorkspace {
  /** `null` enquanto carrega. */
  status: NotionWorkspaceStatus | null
  revalidating: boolean
  revalidate(): Promise<void>
  setStatus(status: NotionWorkspaceStatus): void
}

/**
 * Estado dos bancos do Notion. `refreshKey` muda quando a conexão do Notion muda
 * (conectou/desconectou): aí revalidamos o schema no main. `null` = ainda carregando; espera.
 */
export function useNotionWorkspace(refreshKey: string | null = 'static'): UseNotionWorkspace {
  const [status, setStatus] = useState<NotionWorkspaceStatus | null>(null)
  const [revalidating, setRevalidating] = useState(false)
  const mounted = useRef(true)
  const first = useRef(true)

  const run = useCallback(async (kind: 'getStatus' | 'revalidate') => {
    setRevalidating(true)
    let next: NotionWorkspaceStatus
    try {
      next = await window.orkio.notionWorkspace[kind]()
    } catch {
      next = IPC_FAILURE
    }
    if (!mounted.current) return
    setStatus(next)
    setRevalidating(false)
  }, [])

  useEffect(() => {
    mounted.current = true
    if (refreshKey === null) return
    // Primeira carga: estado do main (que revalida uma vez por sessão); depois, revalida.
    void run(first.current ? 'getStatus' : 'revalidate')
    first.current = false
    return () => {
      mounted.current = false
    }
  }, [run, refreshKey])

  const revalidate = useCallback(() => run('revalidate'), [run])

  return { status, revalidating, revalidate, setStatus }
}

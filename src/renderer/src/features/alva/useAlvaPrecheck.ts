import { useState } from 'react'
import { useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
import type { AlvaPrecheck } from '../../../../shared/alva'

/** Pré-checagem do alva-flow do projeto (`null` = nenhum projeto), compartilhada pelas telas. */
export function useAlvaPrecheck(projectId: string | null): {
  precheck: AlvaPrecheck | null
  checking: boolean
  /** "Verificar de novo": refaz a checagem no main (sem cache). */
  recheck(): Promise<void>
} {
  const { alvaPrecheck } = useSources()
  const precheck = useSource(alvaPrecheck, projectId).value
  const [checking, setChecking] = useState(false)
  return {
    precheck,
    checking,
    recheck: async () => {
      if (!projectId) return
      setChecking(true)
      await alvaPrecheck.reload(projectId, { force: true })
      setChecking(false)
    }
  }
}

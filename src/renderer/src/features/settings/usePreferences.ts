import { useState } from 'react'
import { DEFAULT_PREFERENCES, type AppPreferences } from '../../../../shared/preferences'
import { ipcCall, ipcResult, useIpcResource } from '../../lib/ipc'

/**
 * Preferências que o main aplica (`prefs.*`): lê ao abrir a seção e grava por partes. Mostra o
 * valor novo na hora e volta ao que o main devolveu (ou ao de antes, com a mensagem) se falhar.
 */
export function usePreferences(): {
  prefs: AppPreferences | null
  error: string | null
  save(patch: Partial<AppPreferences>): Promise<boolean>
} {
  const resource = useIpcResource('', () =>
    ipcCall(() => window.orkio.prefs.get(), DEFAULT_PREFERENCES)
  )
  const [error, setError] = useState<string | null>(null)
  const save = async (patch: Partial<AppPreferences>): Promise<boolean> => {
    const before = resource.value
    if (before) resource.set({ ...before, ...patch })
    const r = await ipcResult(() => window.orkio.prefs.save(patch))
    if (r.ok) {
      setError(null)
      resource.set(r.value)
      return true
    }
    setError(r.error.message)
    resource.set(before)
    return false
  }
  return { prefs: resource.value, error, save }
}

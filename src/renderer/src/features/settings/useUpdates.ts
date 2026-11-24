import { useCallback, useState } from 'react'
import { useSources } from '../../app/sources'
import { ipcCall, useSource } from '../../lib/ipc'
import type { UpdateChannel, UpdateStatus } from '../../../../shared/updates'

export function useUpdates(): {
  status: UpdateStatus | null
  checking: boolean
  check(): Promise<void>
  setChannel(channel: UpdateChannel): Promise<void>
} {
  const { updates } = useSources()
  const { value } = useSource(updates, '')
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    // Falha do IPC: o status continua o último conhecido.
    const next = await ipcCall(() => window.orkio.updates.check(), null)
    if (next) updates.set('', next)
    setChecking(false)
  }, [updates])

  const setChannel = useCallback(
    async (channel: UpdateChannel) => {
      const next = await ipcCall(() => window.orkio.updates.setChannel(channel), null)
      if (next) updates.set('', next)
    },
    [updates]
  )

  return { status: value, checking, check, setChannel }
}

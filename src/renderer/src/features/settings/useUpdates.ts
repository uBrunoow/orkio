import { useCallback, useState } from 'react'
import { useSources } from '../../app/sources'
import { useSource } from '../../lib/ipc'
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
    try {
      updates.set('', await window.orkio.updates.check())
    } catch {
      // Falha do IPC: o status continua o último conhecido.
    } finally {
      setChecking(false)
    }
  }, [updates])

  const setChannel = useCallback(
    async (channel: UpdateChannel) => {
      const next = await window.orkio.updates.setChannel(channel).catch(() => null)
      if (next) updates.set('', next)
    },
    [updates]
  )

  return { status: value, checking, check, setChannel }
}

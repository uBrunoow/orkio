import { useCallback, useEffect, useState } from 'react'
import type { UpdateChannel, UpdateStatus } from '../../../../shared/updates'

/** Status das atualizações (6C), ao vivo pelo evento do main. */
export function useUpdates(): {
  status: UpdateStatus | null
  checking: boolean
  check(): Promise<void>
  setChannel(channel: UpdateChannel): Promise<void>
} {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let alive = true
    void window.orkio.updates.status().then((s) => {
      if (alive) setStatus(s)
    })
    const off = window.orkio.updates.onStatus((s) => setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await window.orkio.updates.check())
    } finally {
      setChecking(false)
    }
  }, [])

  const setChannel = useCallback(async (channel: UpdateChannel) => {
    setStatus(await window.orkio.updates.setChannel(channel))
  }, [])

  return { status, checking, check, setChannel }
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Nunca'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? 'Nunca'
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

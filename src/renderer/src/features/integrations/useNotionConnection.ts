import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '../../../../shared/ipc-contract'

/** O que está acontecendo agora, além do status persistido. */
export type NotionActivity = 'loading' | 'idle' | 'connecting' | 'testing' | 'disconnecting'

const IPC_FAILURE: ConnectionStatus = {
  state: 'error',
  message: 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'
}

export interface UseNotionConnection {
  /** `null` enquanto o status salvo ainda está sendo carregado. */
  status: ConnectionStatus | null
  activity: NotionActivity
  /** Momento da última verificação bem-sucedida nesta sessão. */
  lastVerifiedAt: Date | null
  connect(token: string): Promise<ConnectionStatus>
  testConnection(): Promise<void>
  disconnect(): Promise<void>
}

export function useNotionConnection(): UseNotionConnection {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [activity, setActivity] = useState<NotionActivity>('loading')
  const [lastVerifiedAt, setLastVerifiedAt] = useState<Date | null>(null)
  const mounted = useRef(true)

  const apply = useCallback((next: ConnectionStatus) => {
    if (!mounted.current) return
    setStatus(next)
    if (next.state === 'connected' && !next.warning) setLastVerifiedAt(new Date())
  }, [])

  // Ao abrir: mostra o status salvo na hora e revalida em segundo plano.
  useEffect(() => {
    mounted.current = true
    void (async () => {
      const saved = await safeCall(() => window.orkio.notion.getStatus())
      if (!mounted.current) return
      setStatus(saved)
      if (saved.state === 'connected') {
        setActivity('testing')
        apply(await safeCall(() => window.orkio.notion.testConnection()))
      }
      if (mounted.current) setActivity('idle')
    })()
    return () => {
      mounted.current = false
    }
  }, [apply])

  const connect = useCallback(
    async (token: string) => {
      setActivity('connecting')
      setStatus({ state: 'connecting' })
      const next = await safeCall(() => window.orkio.notion.connect({ kind: 'token', token }))
      apply(next)
      if (mounted.current) setActivity('idle')
      return next
    },
    [apply]
  )

  const testConnection = useCallback(async () => {
    setActivity('testing')
    apply(await safeCall(() => window.orkio.notion.testConnection()))
    if (mounted.current) setActivity('idle')
  }, [apply])

  const disconnect = useCallback(async () => {
    setActivity('disconnecting')
    const next = await safeCall(() => window.orkio.notion.disconnect())
    if (mounted.current) {
      setStatus(next)
      setLastVerifiedAt(null)
      setActivity('idle')
    }
  }, [])

  return { status, activity, lastVerifiedAt, connect, testConnection, disconnect }
}

async function safeCall(fn: () => Promise<ConnectionStatus>): Promise<ConnectionStatus> {
  try {
    return await fn()
  } catch {
    return IPC_FAILURE
  }
}

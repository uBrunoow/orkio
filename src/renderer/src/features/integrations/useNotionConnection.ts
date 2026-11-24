import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionActivity } from './connection-ui'
import type { AuthOptions, ConnectionStatus } from '../../../../shared/connection'

export type NotionActivity = ConnectionActivity

const IPC_FAILURE: ConnectionStatus = {
  state: 'error',
  message: 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'
}

export interface UseNotionConnection {
  /** `null` enquanto o status salvo ainda está sendo carregado. */
  status: ConnectionStatus | null
  activity: NotionActivity
  /** Métodos de conexão deste build (`null` enquanto carrega). */
  authOptions: AuthOptions | null
  /** Momento da última verificação bem-sucedida nesta sessão. */
  lastVerifiedAt: Date | null
  connect(token: string): Promise<ConnectionStatus>
  /** Abre o Notion no navegador; resolve quando o usuário autoriza, recusa ou cancela. */
  startOAuth(): Promise<ConnectionStatus>
  cancelOAuth(): Promise<void>
  testConnection(): Promise<void>
  disconnect(): Promise<void>
}

export function useNotionConnection(): UseNotionConnection {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [activity, setActivity] = useState<NotionActivity>('loading')
  const [authOptions, setAuthOptions] = useState<AuthOptions | null>(null)
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
    void window.orkio.notion
      .getAuthOptions()
      .catch(() => ({ oauth: false }))
      .then((options) => {
        if (mounted.current) setAuthOptions(options)
      })
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

  const startOAuth = useCallback(async () => {
    setActivity('authorizing')
    const next = await safeCall(() => window.orkio.notion.startOAuth())
    apply(next)
    if (mounted.current) setActivity('idle')
    return next
  }, [apply])

  const cancelOAuth = useCallback(async () => {
    // O startOAuth pendente resolve com o status salvo assim que o main cancelar.
    await window.orkio.notion.cancelOAuth().catch(() => {})
  }, [])

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

  return {
    status,
    activity,
    authOptions,
    lastVerifiedAt,
    connect,
    startOAuth,
    cancelOAuth,
    testConnection,
    disconnect
  }
}

async function safeCall(fn: () => Promise<ConnectionStatus>): Promise<ConnectionStatus> {
  try {
    return await fn()
  } catch {
    return IPC_FAILURE
  }
}

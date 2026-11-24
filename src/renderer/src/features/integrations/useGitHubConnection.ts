import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionActivity } from './connection-ui'
import type { AuthOptions, ConnectionStatus, DeviceFlowInfo } from '../../../../shared/connection'

const IPC_FAILURE: ConnectionStatus = {
  state: 'error',
  message: 'Não foi possível falar com o processo principal do Orkio. Reinicie o app.'
}

export interface UseGitHubConnection {
  /** `null` enquanto o status salvo ainda está sendo carregado. */
  status: ConnectionStatus | null
  activity: ConnectionActivity
  authOptions: AuthOptions | null
  /** Código e página do Device Flow em andamento (nunca contém tokens). */
  deviceFlow: DeviceFlowInfo | null
  lastVerifiedAt: Date | null
  connect(token: string): Promise<ConnectionStatus>
  /** Pede o código, mostra na tela e espera a autorização (o polling roda no main). */
  startDeviceFlow(): Promise<ConnectionStatus>
  cancelDeviceFlow(): Promise<void>
  testConnection(): Promise<void>
  disconnect(): Promise<void>
}

export function useGitHubConnection(): UseGitHubConnection {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [activity, setActivity] = useState<ConnectionActivity>('loading')
  const [authOptions, setAuthOptions] = useState<AuthOptions | null>(null)
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowInfo | null>(null)
  const [lastVerifiedAt, setLastVerifiedAt] = useState<Date | null>(null)
  const mounted = useRef(true)

  const apply = useCallback((next: ConnectionStatus) => {
    if (!mounted.current) return
    setStatus(next)
    if (next.state === 'connected' && !next.warning) setLastVerifiedAt(new Date())
  }, [])

  // Ao abrir: status salvo na hora, revalidação em segundo plano.
  useEffect(() => {
    mounted.current = true
    void window.orkio.github
      .getAuthOptions()
      .catch(() => ({ oauth: false }))
      .then((options) => {
        if (mounted.current) setAuthOptions(options)
      })
    void (async () => {
      const saved = await safeCall(() => window.orkio.github.getStatus())
      if (!mounted.current) return
      setStatus(saved)
      if (saved.state === 'connected') {
        setActivity('testing')
        apply(await safeCall(() => window.orkio.github.testConnection()))
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
      const next = await safeCall(() => window.orkio.github.connect({ kind: 'token', token }))
      apply(next)
      if (mounted.current) setActivity('idle')
      return next
    },
    [apply]
  )

  const startDeviceFlow = useCallback(async () => {
    setActivity('authorizing')
    let next: ConnectionStatus
    try {
      const start = await window.orkio.github.startDeviceFlow()
      if (start.ok) {
        if (mounted.current) setDeviceFlow(start.flow)
        next = await safeCall(() => window.orkio.github.waitDeviceFlow())
      } else {
        next = start.status
      }
    } catch {
      next = IPC_FAILURE
    }
    apply(next)
    if (mounted.current) {
      setDeviceFlow(null)
      setActivity('idle')
    }
    return next
  }, [apply])

  const cancelDeviceFlow = useCallback(async () => {
    // O waitDeviceFlow pendente resolve com o status salvo assim que o main cancelar.
    await window.orkio.github.cancelDeviceFlow().catch(() => {})
  }, [])

  const testConnection = useCallback(async () => {
    setActivity('testing')
    apply(await safeCall(() => window.orkio.github.testConnection()))
    if (mounted.current) setActivity('idle')
  }, [apply])

  const disconnect = useCallback(async () => {
    setActivity('disconnecting')
    const next = await safeCall(() => window.orkio.github.disconnect())
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
    deviceFlow,
    lastVerifiedAt,
    connect,
    startDeviceFlow,
    cancelDeviceFlow,
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

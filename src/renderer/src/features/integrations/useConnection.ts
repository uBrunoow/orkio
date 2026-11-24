import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONNECTION_IPC_FAILURE,
  connectorApi,
  useSources,
  type ConnectorKind
} from '../../app/sources'
import { ipcCall, useSource } from '../../lib/ipc'
import type { AuthOptions, ConnectionStatus, DeviceFlowInfo } from '../../../../shared/connection'

export type ConnectionActivity =
  'loading' | 'idle' | 'connecting' | 'authorizing' | 'testing' | 'disconnecting'

export interface UseConnection {
  kind: ConnectorKind
  /** `null` enquanto o status salvo ainda está sendo carregado. */
  status: ConnectionStatus | null
  activity: ConnectionActivity
  /** Métodos de conexão deste build (`null` enquanto carrega). */
  authOptions: AuthOptions | null
  /** Código e página do Device Flow do GitHub em andamento (nunca contém tokens). */
  deviceFlow: DeviceFlowInfo | null
  lastVerifiedAt: Date | null
  /** Muda quando a conexão muda (conectou, desconectou, reconectou); `null` = ainda não se sabe. */
  key: string | null
  connect(token: string): Promise<ConnectionStatus>
  /** Login pelo navegador (OAuth do Notion, Device Flow do GitHub); resolve quando termina. */
  authorize(): Promise<ConnectionStatus>
  cancelAuthorize(): Promise<void>
  testConnection(): Promise<void>
  disconnect(): Promise<void>
}

function connectionKey(status: ConnectionStatus | null): string | null {
  if (status === null || status.state === 'connecting') return null
  return status.state === 'connected' ? `connected:${status.connectedAt}` : status.state
}

/** Só o status salvo da conexão (sem rede), compartilhado pelo App. */
export function useConnectionStatus(kind: ConnectorKind): ConnectionStatus | null {
  return useSource(useSources().connections, kind).value
}

/**
 * Conexão de um conector (Notion ou GitHub), com o estado compartilhado pelo App: conectar aqui
 * atualiza a conta no menu, os Primeiros passos e Integrações. Com `revalidate`, ao montar mostra
 * o status salvo e revalida na API em segundo plano (cards de conexão).
 */
export function useConnection(
  kind: ConnectorKind,
  { revalidate = false }: { revalidate?: boolean } = {}
): UseConnection {
  const sources = useSources()
  const { connections, verifiedAt } = sources
  const status = useSource(connections, kind).value
  const lastVerifiedAt = useSource(verifiedAt, kind).value
  const authOptions = useSource(sources.authOptions, kind).value
  const [activity, setActivity] = useState<ConnectionActivity>(revalidate ? 'loading' : 'idle')
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowInfo | null>(null)
  const mounted = useRef(true)

  const apply = useCallback(
    (next: ConnectionStatus) => {
      connections.set(kind, next)
      if (next.state === 'connected' && !next.warning) verifiedAt.set(kind, new Date())
    },
    [connections, verifiedAt, kind]
  )

  const run = useCallback(
    async (
      act: ConnectionActivity,
      fn: () => Promise<ConnectionStatus>
    ): Promise<ConnectionStatus> => {
      if (mounted.current) setActivity(act)
      const next = await ipcCall(fn, CONNECTION_IPC_FAILURE)
      apply(next)
      if (mounted.current) setActivity('idle')
      return next
    },
    [apply]
  )

  useEffect(() => {
    mounted.current = true
    if (revalidate) {
      void (async () => {
        await connections.reload(kind)
        if (!mounted.current) return
        if (connections.get(kind).value?.state === 'connected') {
          await run('testing', () => connectorApi(kind).testConnection())
        } else setActivity('idle')
      })()
    }
    return () => {
      mounted.current = false
    }
  }, [revalidate, connections, kind, run])

  const connect = useCallback(
    (token: string) => {
      connections.set(kind, { state: 'connecting' })
      return run('connecting', () => connectorApi(kind).connect({ kind: 'token', token }))
    },
    [connections, kind, run]
  )

  const authorize = useCallback(
    () =>
      run('authorizing', async () => {
        if (kind === 'notion') return window.orkio.notion.startOAuth()
        const start = await window.orkio.github.startDeviceFlow()
        if (!start.ok) return start.status
        if (mounted.current) setDeviceFlow(start.flow)
        try {
          return await window.orkio.github.waitDeviceFlow()
        } finally {
          if (mounted.current) setDeviceFlow(null)
        }
      }),
    [kind, run]
  )

  const cancelAuthorize = useCallback(async () => {
    // O login pendente resolve com o status salvo assim que o main cancelar.
    await (
      kind === 'notion' ? window.orkio.notion.cancelOAuth() : window.orkio.github.cancelDeviceFlow()
    ).catch(() => undefined)
  }, [kind])

  const testConnection = useCallback(async () => {
    await run('testing', () => connectorApi(kind).testConnection())
  }, [kind, run])

  const disconnect = useCallback(async () => {
    await run('disconnecting', () => connectorApi(kind).disconnect())
    verifiedAt.set(kind, null)
  }, [kind, run, verifiedAt])

  return {
    kind,
    status,
    activity,
    authOptions,
    deviceFlow,
    lastVerifiedAt,
    key: connectionKey(status),
    connect,
    authorize,
    cancelAuthorize,
    testConnection,
    disconnect
  }
}

import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ConnectionStatus, DeviceFlowInfo } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'
import { GitHubLogo } from '../../components/icons'
import { DeviceFlowView } from '../integrations/GitHubConnectionCard'

/**
 * Entrada do app: login com a conta do GitHub pelo Device Flow que Integrações já usa (o token
 * fica no main, cifrado). Conectar aqui já liga a integração do GitHub; depois o checklist pede o
 * Notion e o projeto. O GitHub é obrigatório: o projeto é verificado nele.
 */
export function LoginPanel({
  oauth,
  onConnected,
  onUseToken
}: {
  /** false quando o build não tem o login do GitHub configurado. */
  oauth: boolean
  onConnected(status: ConnectionStatus): void
  onUseToken(): void
}): React.JSX.Element {
  const [authorizing, setAuthorizing] = useState(false)
  const [flow, setFlow] = useState<DeviceFlowInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function signIn(): Promise<void> {
    setError(null)
    setAuthorizing(true)
    let next: ConnectionStatus
    try {
      const start = await window.orkio.github.startDeviceFlow()
      if (start.ok) {
        setFlow(start.flow)
        next = await window.orkio.github.waitDeviceFlow()
      } else next = start.status
    } catch {
      next = { state: 'error', message: 'Não foi possível falar com o Orkio. Reinicie o app.' }
    }
    setFlow(null)
    setAuthorizing(false)
    if (next.state === 'connected') onConnected(next)
    else if (next.state === 'error') setError(next.message)
  }

  return (
    <VStack gap={4} role="region" aria-label="Entrar no Orkio">
      {error && <Alert tone="danger">{error}</Alert>}
      {authorizing ? (
        <DeviceFlowView
          flow={flow}
          onCancel={() => window.orkio.github.cancelDeviceFlow().catch(() => undefined)}
        />
      ) : (
        <HStack gap={2} vAlign="center" wrap="wrap">
          {oauth ? (
            <Button
              variant="primary"
              label={error ? 'Tentar de novo' : 'Entrar com GitHub'}
              icon={<Icon icon={GitHubLogo} />}
              onClick={() => void signIn()}
            />
          ) : (
            <Text type="supporting" color="secondary">
              Este build não tem o login do GitHub configurado. Conecte com um token.
            </Text>
          )}
          <Button variant="secondary" label="Usar um token" onClick={onUseToken} />
        </HStack>
      )}
    </VStack>
  )
}

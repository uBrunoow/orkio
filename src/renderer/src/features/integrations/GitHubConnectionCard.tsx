import { useEffect, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { ExternalLinkIcon, GitHubLogo } from '../../components/icons'
import { Item } from '@astryxdesign/core/Item'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import {
  GITHUB_TOKEN_DOCS_URL,
  type ConnectionStatus,
  type DeviceFlowInfo
} from '../../../../shared/ipc-contract'
import {
  Alert,
  CardHeader,
  ConnectedView,
  StatusBadge,
  StoredCredentialErrorView,
  TokenFallbackFooter,
  TokenForm,
  type TokenFormCopy
} from './connection-ui'
import type { UseGitHubConnection } from './useGitHubConnection'

const TOKEN_COPY: TokenFormCopy = {
  description:
    'Cole um fine-grained personal access token com acesso aos repositórios que o Orkio vai usar. Ele fica criptografado no seu computador.',
  label: 'Token do GitHub',
  placeholder: 'github_pat_…',
  hint: 'Validado em api.github.com antes de ser salvo.',
  docsUrl: GITHUB_TOKEN_DOCS_URL
}

export function GitHubConnectionCard({
  github
}: {
  github: UseGitHubConnection
}): React.JSX.Element {
  const { status, activity } = github

  return (
    <Card role="region" aria-labelledby="github-card-title" aria-busy={activity !== 'idle'}>
      <VStack gap={4}>
        <CardHeader
          titleId="github-card-title"
          title="GitHub"
          description="Código: repositórios, branches e PRs."
          icon={<Icon icon={GitHubLogo} color="primary" size="lg" />}
          badge={<StatusBadge status={status} activity={activity} waitingLabel="Aguardando…" />}
        />
        <VStack gap={4} aria-live="polite">
          {status === null ? (
            <Skeleton height={40} aria-label="Carregando status da conexão" />
          ) : activity === 'authorizing' ? (
            <DeviceFlowView flow={github.deviceFlow} onCancel={github.cancelDeviceFlow} />
          ) : status.state === 'connected' ? (
            <ConnectedView
              account={status.account}
              connectedAt={status.connectedAt}
              warning={status.warning}
              activity={activity}
              lastVerifiedAt={github.lastVerifiedAt}
              onTest={github.testConnection}
              onDisconnect={github.disconnect}
            />
          ) : status.state === 'error' && status.hasStoredCredentials ? (
            <StoredCredentialErrorView
              message={status.message}
              activity={activity}
              onRetry={github.testConnection}
              onDisconnect={github.disconnect}
              onReconnect={github.authOptions?.oauth ? github.startDeviceFlow : undefined}
              reconnectLabel="Reconectar com GitHub"
            />
          ) : (
            <DisconnectedView
              error={status.state === 'error' ? status.message : null}
              connecting={activity === 'connecting'}
              oauthAvailable={github.authOptions ? github.authOptions.oauth : null}
              onConnectToken={github.connect}
              onStartDeviceFlow={github.startDeviceFlow}
            />
          )}
        </VStack>
      </VStack>
    </Card>
  )
}

function DisconnectedView({
  error,
  connecting,
  oauthAvailable,
  onConnectToken,
  onStartDeviceFlow
}: {
  error: string | null
  connecting: boolean
  oauthAvailable: boolean | null
  onConnectToken: (token: string) => Promise<ConnectionStatus>
  onStartDeviceFlow: () => Promise<ConnectionStatus>
}): React.JSX.Element {
  const [useToken, setUseToken] = useState(false)

  if (oauthAvailable === null) {
    return <Skeleton height={40} aria-label="Carregando opções de conexão" />
  }

  if (useToken || !oauthAvailable) {
    return (
      <VStack gap={3}>
        <TokenForm
          copy={TOKEN_COPY}
          error={error}
          connecting={connecting}
          onConnect={onConnectToken}
        />
        <TokenFallbackFooter
          oauthAvailable={oauthAvailable}
          connecting={connecting}
          primaryLabel="Conectar com GitHub"
          unavailableMessage="O login com GitHub não está disponível nesta versão do Orkio."
          onBack={() => setUseToken(false)}
        />
      </VStack>
    )
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Autorize o Orkio na sua conta do GitHub digitando um código no navegador. O Orkio pede
        acesso aos seus repositórios (escopo <Code>repo</Code>) para ler código e PRs e, mais tarde,
        abrir PRs.
      </Text>
      {error && <Alert tone="danger">{error}</Alert>}
      <HStack gap={2} vAlign="center">
        <Button
          variant="primary"
          label={error ? 'Tentar novamente' : 'Conectar com GitHub'}
          onClick={() => void onStartDeviceFlow()}
        />
        <Button variant="ghost" label="Usar token" onClick={() => setUseToken(true)} />
      </HStack>
    </VStack>
  )
}

function DeviceFlowView({
  flow,
  onCancel
}: {
  flow: DeviceFlowInfo | null
  onCancel: () => Promise<void>
}): React.JSX.Element {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const remaining = useCountdown(flow?.expiresAt ?? null)

  if (!flow) {
    return (
      <Item
        role="status"
        startContent={<Spinner size="md" aria-label="Aguardando" />}
        label="Pedindo um código ao GitHub…"
      />
    )
  }

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(flow!.userCode)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Abra o GitHub, digite o código abaixo e clique em <Text weight="semibold">Authorize</Text>.
        O Orkio conecta sozinho assim que você autorizar.
      </Text>
      <Card variant="muted" padding={3}>
        <HStack gap={3} vAlign="center" justify="between">
          <Text type="display-3" aria-label={`Código: ${flow.userCode}`}>
            <Code size="inherit" data-testid="device-code">
              {flow.userCode}
            </Code>
          </Text>
          <Button
            label={copy === 'copied' ? 'Copiado' : 'Copiar'}
            onClick={() => void copyCode()}
          />
        </HStack>
      </Card>
      {copy === 'failed' && (
        <Text type="supporting">Não foi possível copiar. Selecione o código e copie à mão.</Text>
      )}
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button
          variant="primary"
          label="Abrir GitHub"
          icon={<Icon icon={ExternalLinkIcon} />}
          onClick={() => void window.orkio.openExternal(flow.verificationUri)}
        />
        <Button label="Cancelar" onClick={() => void onCancel()} />
        <HStack gap={2} vAlign="center" role="timer">
          <Spinner size="sm" aria-label="Aguardando autorização" />
          <Text type="supporting">
            {remaining > 0
              ? `Aguardando · expira em ${formatRemaining(remaining)}`
              : 'Código expirado'}
          </Text>
        </HStack>
      </HStack>
    </VStack>
  )
}

/** Segundos restantes até `expiresAt`, atualizado a cada segundo. */
function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  return expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000)) : 0
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

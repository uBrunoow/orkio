import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { NotionLogo } from '../../components/icons'
import { Item } from '@astryxdesign/core/Item'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { NOTION_TOKEN_DOCS_URL, type ConnectionStatus } from '../../../../shared/ipc-contract'
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
import type { UseNotionConnection } from './useNotionConnection'

const TOKEN_COPY: TokenFormCopy = {
  description:
    'Cole um token pessoal (PAT) ou de integração interna do Notion. Ele fica criptografado no seu computador e só é usado pelo Orkio para falar com a API do Notion.',
  label: 'Token do Notion',
  placeholder: 'ntn_…',
  hint: 'Validado em api.notion.com antes de ser salvo.',
  docsUrl: NOTION_TOKEN_DOCS_URL
}

export function NotionConnectionCard({
  notion
}: {
  notion: UseNotionConnection
}): React.JSX.Element {
  const { status, activity } = notion

  return (
    <Card role="region" aria-labelledby="notion-card-title" aria-busy={activity !== 'idle'}>
      <VStack gap={4}>
        <CardHeader
          titleId="notion-card-title"
          title="Notion"
          description="Planejamento: páginas, bancos e tarefas."
          icon={<Icon icon={NotionLogo} color="primary" size="lg" />}
          badge={
            <StatusBadge status={status} activity={activity} waitingLabel="Aguardando o Notion…" />
          }
        />
        <VStack gap={4} aria-live="polite">
          {status === null ? (
            <Skeleton height={40} aria-label="Carregando status da conexão" />
          ) : activity === 'authorizing' ? (
            <AuthorizingView onCancel={notion.cancelOAuth} />
          ) : status.state === 'connected' ? (
            <ConnectedView
              account={status.account}
              connectedAt={status.connectedAt}
              warning={status.warning}
              activity={activity}
              lastVerifiedAt={notion.lastVerifiedAt}
              onTest={notion.testConnection}
              onDisconnect={notion.disconnect}
            />
          ) : status.state === 'error' && status.hasStoredCredentials ? (
            <StoredCredentialErrorView
              message={status.message}
              activity={activity}
              onRetry={notion.testConnection}
              onDisconnect={notion.disconnect}
              onReconnect={notion.authOptions?.oauth ? notion.startOAuth : undefined}
              reconnectLabel="Reconectar com Notion"
            />
          ) : (
            <DisconnectedView
              error={status.state === 'error' ? status.message : null}
              connecting={activity === 'connecting'}
              oauthAvailable={notion.authOptions ? notion.authOptions.oauth : null}
              onConnectToken={notion.connect}
              onStartOAuth={notion.startOAuth}
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
  onStartOAuth
}: {
  error: string | null
  connecting: boolean
  /** `null` enquanto as opções do build carregam. */
  oauthAvailable: boolean | null
  onConnectToken: (token: string) => Promise<ConnectionStatus>
  onStartOAuth: () => Promise<ConnectionStatus>
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
          primaryLabel="Conectar com Notion"
          unavailableMessage="O login com Notion não está disponível nesta versão do Orkio."
          onBack={() => setUseToken(false)}
        />
      </VStack>
    )
  }

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Entre com a sua conta do Notion e escolha as páginas que o Orkio pode ler. Você autoriza no
        navegador; nenhuma senha passa pelo Orkio.
      </Text>
      {error && <Alert tone="danger">{error}</Alert>}
      <HStack gap={2} vAlign="center">
        <Button
          variant="primary"
          label={error ? 'Tentar novamente' : 'Conectar com Notion'}
          onClick={() => void onStartOAuth()}
        />
        <Button variant="ghost" label="Usar token" onClick={() => setUseToken(true)} />
      </HStack>
    </VStack>
  )
}

function AuthorizingView({ onCancel }: { onCancel: () => Promise<void> }): React.JSX.Element {
  return (
    <VStack gap={4}>
      <Item
        role="status"
        startContent={<Spinner size="md" aria-label="Aguardando" />}
        label="Aguardando autorização no Notion…"
        description="Conclua no navegador que abriu: escolha o workspace e as páginas e clique em Permitir. Depois é só voltar para cá."
      />
      <HStack>
        <Button label="Cancelar" onClick={() => void onCancel()} />
      </HStack>
    </VStack>
  )
}

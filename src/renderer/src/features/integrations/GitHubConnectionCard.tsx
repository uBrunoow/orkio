import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GitHubLogo } from '../../components/icons'
import { Alert } from '../../components/Alert'
import { PanelHeader } from '../../components/PanelHeader'
import { DeviceFlowView } from './DeviceFlowView'
import {
  CONNECTION_CARD_CLASS,
  ConnectedView,
  StatusBadge,
  StoredCredentialErrorView,
  TokenFallbackFooter,
  TokenForm,
  type TokenFormCopy
} from './connection-ui'
import type { UseConnection } from './useConnection'
import { GITHUB_TOKEN_DOCS_URL, type ConnectionStatus } from '../../../../shared/connection'

const TOKEN_COPY: TokenFormCopy = {
  description:
    'Cole um fine-grained personal access token com acesso aos repositórios que o Orkio vai usar. Ele fica criptografado no seu computador.',
  label: 'Token do GitHub',
  placeholder: 'github_pat_…',
  hint: 'Validado em api.github.com antes de ser salvo.',
  docsUrl: GITHUB_TOKEN_DOCS_URL
}

export function GitHubConnectionCard({ github }: { github: UseConnection }): React.JSX.Element {
  const { status, activity } = github

  return (
    <section
      aria-labelledby="github-card-title"
      aria-busy={activity !== 'idle'}
      className={CONNECTION_CARD_CLASS}
    >
      <PanelHeader
        titleId="github-card-title"
        title="GitHub"
        description="Código: repositórios, branches e PRs."
        icon={<GitHubLogo className="size-[18px]" />}
        badge={<StatusBadge status={status} activity={activity} waitingLabel="Aguardando…" />}
      />
      <div className="flex flex-col gap-4" aria-live="polite">
        {status === null ? (
          <Skeleton className="h-10" aria-label="Carregando status da conexão" />
        ) : activity === 'authorizing' ? (
          <DeviceFlowView flow={github.deviceFlow} onCancel={github.cancelAuthorize} />
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
            onReconnect={github.authOptions?.oauth ? github.authorize : undefined}
            reconnectLabel="Reconectar com GitHub"
          />
        ) : (
          <DisconnectedView
            error={status.state === 'error' ? status.message : null}
            connecting={activity === 'connecting'}
            oauthAvailable={github.authOptions ? github.authOptions.oauth : null}
            onConnectToken={github.connect}
            onStartDeviceFlow={github.authorize}
          />
        )}
      </div>
    </section>
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
    return <Skeleton className="h-10" aria-label="Carregando opções de conexão" />
  }

  if (useToken || !oauthAvailable) {
    return (
      <div className="flex flex-col gap-3">
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
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Autorize o Orkio na sua conta do GitHub digitando um código no navegador. O Orkio pede
        acesso aos seus repositórios (escopo <code className="font-mono text-xs">repo</code>) para
        ler código e PRs e, mais tarde, abrir PRs.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button onClick={() => void onStartDeviceFlow()}>
          {error ? 'Tentar novamente' : 'Conectar com GitHub'}
        </Button>
        <Button variant="ghost" onClick={() => setUseToken(true)}>
          Usar token
        </Button>
      </div>
    </div>
  )
}

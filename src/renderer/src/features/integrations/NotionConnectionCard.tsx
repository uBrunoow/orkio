import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/Spinner'
import { NotionLogo } from '../../components/icons'
import {
  Alert,
  CardHeader,
  CONNECTION_CARD_CLASS,
  ConnectedView,
  StatusBadge,
  StoredCredentialErrorView,
  TokenFallbackFooter,
  TokenForm,
  type TokenFormCopy
} from './connection-ui'
import type { UseNotionConnection } from './useNotionConnection'
import { NOTION_TOKEN_DOCS_URL, type ConnectionStatus } from '../../../../shared/connection'

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
    <section
      aria-labelledby="notion-card-title"
      aria-busy={activity !== 'idle'}
      className={CONNECTION_CARD_CLASS}
    >
      <CardHeader
        titleId="notion-card-title"
        title="Notion"
        description="Planejamento: páginas, bancos e tarefas."
        icon={<NotionLogo className="size-[18px]" />}
        badge={
          <StatusBadge status={status} activity={activity} waitingLabel="Aguardando o Notion…" />
        }
      />
      <div className="flex flex-col gap-4" aria-live="polite">
        {status === null ? (
          <Skeleton className="h-10" aria-label="Carregando status da conexão" />
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
      </div>
    </section>
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
          primaryLabel="Conectar com Notion"
          unavailableMessage="O login com Notion não está disponível nesta versão do Orkio."
          onBack={() => setUseToken(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Entre com a sua conta do Notion e escolha as páginas que o Orkio pode ler. Você autoriza no
        navegador; nenhuma senha passa pelo Orkio.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button onClick={() => void onStartOAuth()}>
          {error ? 'Tentar novamente' : 'Conectar com Notion'}
        </Button>
        <Button variant="ghost" onClick={() => setUseToken(true)}>
          Usar token
        </Button>
      </div>
    </div>
  )
}

function AuthorizingView({ onCancel }: { onCancel: () => Promise<void> }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-start gap-2.5">
        <Spinner label="Aguardando" className="mt-0.5" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-foreground">Aguardando autorização no Notion…</span>
          <span className="text-xs text-muted-foreground">
            Conclua no navegador que abriu: escolha o workspace e as páginas e clique em Permitir.
            Depois é só voltar para cá.
          </span>
        </div>
      </div>
      <div className="flex">
        <Button variant="outline" onClick={() => void onCancel()}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

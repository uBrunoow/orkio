import { useState } from 'react'
import { NOTION_TOKEN_DOCS_URL, type ConnectionStatus } from '../../../../shared/ipc-contract'
import {
  Alert,
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
    <section className="card" aria-labelledby="notion-card-title" aria-busy={activity !== 'idle'}>
      <header className="card__header">
        <div className="card__icon" aria-hidden="true">
          <NotionMark />
        </div>
        <div>
          <h2 className="card__title" id="notion-card-title">
            Notion
          </h2>
          <p className="card__description">Planejamento: páginas, bancos e tarefas.</p>
        </div>
        <StatusBadge status={status} activity={activity} waitingLabel="Aguardando o Notion…" />
      </header>

      <div className="card__body" aria-live="polite">
        {status === null ? (
          <div className="skeleton" aria-label="Carregando status da conexão" />
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
    return <div className="skeleton" aria-label="Carregando opções de conexão" />
  }

  if (useToken || !oauthAvailable) {
    return (
      <>
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
      </>
    )
  }

  return (
    <>
      <p className="muted">
        Entre com a sua conta do Notion e escolha as páginas que o Orkio pode ler. Você autoriza no
        navegador; nenhuma senha passa pelo Orkio.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="card__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void onStartOAuth()}
        >
          {error ? 'Tentar novamente' : 'Conectar com Notion'}
        </button>
        <button
          type="button"
          className="link-button link-button--muted"
          onClick={() => setUseToken(true)}
        >
          Usar token
        </button>
      </div>
    </>
  )
}

function AuthorizingView({ onCancel }: { onCancel: () => Promise<void> }): React.JSX.Element {
  return (
    <>
      <div className="authorizing" role="status">
        <span className="spinner" aria-hidden="true" />
        <div>
          <div className="account__name">Aguardando autorização no Notion…</div>
          <p className="muted">
            Conclua no navegador que abriu: escolha o workspace e as páginas e clique em Permitir.
            Depois é só voltar para cá.
          </p>
        </div>
      </div>
      <div className="card__actions">
        <button type="button" className="button" onClick={() => void onCancel()}>
          Cancelar
        </button>
      </div>
    </>
  )
}

function NotionMark(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 16.5V8l6 8.5V8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

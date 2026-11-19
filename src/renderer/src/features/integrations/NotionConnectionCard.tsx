import { useId, useState, type FormEvent } from 'react'
import {
  NOTION_TOKEN_DOCS_URL,
  type ConnectedAccount,
  type ConnectionStatus
} from '../../../../shared/ipc-contract'
import type { NotionActivity, UseNotionConnection } from './useNotionConnection'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' })

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
        <StatusBadge status={status} activity={activity} />
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

function StatusBadge({
  status,
  activity
}: {
  status: ConnectionStatus | null
  activity: NotionActivity
}): React.JSX.Element | null {
  if (status === null) return null
  if (activity === 'testing') return <span className="badge">Verificando…</span>
  if (activity === 'authorizing') return <span className="badge">Aguardando o Notion…</span>
  switch (status.state) {
    case 'connected':
      return status.warning ? (
        <span className="badge badge--warning">Conectado (sem verificação)</span>
      ) : (
        <span className="badge badge--success">Conectado</span>
      )
    case 'connecting':
      return <span className="badge">Conectando…</span>
    case 'error':
      return <span className="badge badge--danger">Erro</span>
    case 'disconnected':
      return <span className="badge">Desconectado</span>
  }
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
        <ConnectForm error={error} connecting={connecting} onConnect={onConnectToken} />
        {oauthAvailable ? (
          <button
            type="button"
            className="link-button link-button--muted"
            onClick={() => setUseToken(false)}
            disabled={connecting}
          >
            ← Voltar para “Conectar com Notion”
          </button>
        ) : (
          <p className="field__hint">
            O login com Notion não está disponível nesta versão do Orkio.
          </p>
        )}
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

function ConnectForm({
  error,
  connecting,
  onConnect
}: {
  error: string | null
  connecting: boolean
  onConnect: (token: string) => Promise<ConnectionStatus>
}): React.JSX.Element {
  const [token, setToken] = useState('')
  const inputId = useId()
  const hintId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (connecting || token.trim() === '') return
    const result = await onConnect(token)
    // Não mantemos o token na memória da UI depois de conectar.
    if (result.state === 'connected') setToken('')
  }

  return (
    <form className="card__body" onSubmit={(e) => void handleSubmit(e)} noValidate>
      <p className="muted">
        Cole um token pessoal (PAT) ou de integração interna do Notion. Ele fica criptografado no
        seu computador e só é usado pelo Orkio para falar com a API do Notion.
      </p>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="field">
        <div className="field__label-row">
          <label className="field__label" htmlFor={inputId}>
            Token do Notion
          </label>
          <button
            type="button"
            className="link-button"
            onClick={() => void window.orkio.openExternal(NOTION_TOKEN_DOCS_URL)}
          >
            Como criar um token ↗
          </button>
        </div>
        <input
          id={inputId}
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="ntn_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={connecting}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
        />
        <span className="field__hint" id={hintId}>
          Validado em api.notion.com antes de ser salvo.
        </span>
      </div>

      <div className="card__actions">
        <button
          type="submit"
          className="button button--primary"
          disabled={connecting || token.trim() === ''}
        >
          {connecting && <span className="spinner" aria-hidden="true" />}
          {connecting ? 'Conectando…' : error ? 'Tentar novamente' : 'Conectar'}
        </button>
      </div>
    </form>
  )
}

function ConnectedView({
  account,
  connectedAt,
  warning,
  activity,
  lastVerifiedAt,
  onTest,
  onDisconnect
}: {
  account: ConnectedAccount
  connectedAt: string
  warning: string | undefined
  activity: NotionActivity
  lastVerifiedAt: Date | null
  onTest: () => Promise<void>
  onDisconnect: () => Promise<void>
}): React.JSX.Element {
  const busy = activity !== 'idle'
  return (
    <>
      <div className="account">
        <Avatar account={account} />
        <div>
          <div className="account__name">{account.userName}</div>
          <div className="account__meta">
            {account.workspaceName ? `${account.workspaceName} · ` : ''}
            Conectado em {formatDate(connectedAt)}
          </div>
        </div>
      </div>

      {warning && <Alert tone="warning">{warning}</Alert>}

      <div className="card__actions">
        <button type="button" className="button" onClick={() => void onTest()} disabled={busy}>
          {activity === 'testing' && <span className="spinner" aria-hidden="true" />}
          {activity === 'testing' ? 'Testando…' : 'Testar conexão'}
        </button>
        <DisconnectButton
          busy={busy}
          disconnecting={activity === 'disconnecting'}
          onConfirm={onDisconnect}
        />
        {lastVerifiedAt && !warning && activity === 'idle' && (
          <span className="muted">Verificado às {timeFormatter.format(lastVerifiedAt)}</span>
        )}
      </div>
    </>
  )
}

function StoredCredentialErrorView({
  message,
  activity,
  onRetry,
  onDisconnect,
  onReconnect
}: {
  message: string
  activity: NotionActivity
  onRetry: () => Promise<void>
  onDisconnect: () => Promise<void>
  /** Presente quando o build tem login com Notion (OAuth). */
  onReconnect: (() => Promise<ConnectionStatus>) | undefined
}): React.JSX.Element {
  const busy = activity !== 'idle'
  return (
    <>
      <Alert tone="danger">{message}</Alert>
      <p className="muted">
        {onReconnect
          ? 'Reconecte para autorizar o Orkio de novo, ou desconecte para remover a conexão.'
          : 'Se o token foi revogado, desconecte e conecte de novo com um token novo.'}
      </p>
      <div className="card__actions">
        {onReconnect && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void onReconnect()}
            disabled={busy}
          >
            Reconectar com Notion
          </button>
        )}
        <button type="button" className="button" onClick={() => void onRetry()} disabled={busy}>
          {activity === 'testing' && <span className="spinner" aria-hidden="true" />}
          {activity === 'testing' ? 'Testando…' : 'Tentar novamente'}
        </button>
        <DisconnectButton
          busy={busy}
          disconnecting={activity === 'disconnecting'}
          onConfirm={onDisconnect}
        />
      </div>
    </>
  )
}

function DisconnectButton({
  busy,
  disconnecting,
  onConfirm
}: {
  busy: boolean
  disconnecting: boolean
  onConfirm: () => Promise<void>
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)

  if (!confirming && !disconnecting) {
    return (
      <button
        type="button"
        className="button button--danger"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        Desconectar
      </button>
    )
  }

  return (
    <span className="confirm" role="group" aria-label="Confirmar desconexão">
      <span>Remover a conexão deste computador?</span>
      <button
        type="button"
        className="button"
        onClick={() => setConfirming(false)}
        disabled={disconnecting}
      >
        Cancelar
      </button>
      <button
        type="button"
        className="button button--danger-solid"
        onClick={() => void onConfirm().finally(() => setConfirming(false))}
        disabled={disconnecting}
        autoFocus
      >
        {disconnecting && <span className="spinner" aria-hidden="true" />}
        {disconnecting ? 'Desconectando…' : 'Desconectar'}
      </button>
    </span>
  )
}

function Avatar({ account }: { account: ConnectedAccount }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  if (account.avatarUrl && !broken) {
    return (
      <img
        className="avatar"
        src={account.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className="avatar" aria-hidden="true">
      {initials(account.userName)}
    </span>
  )
}

function Alert({
  tone,
  children
}: {
  tone: 'danger' | 'warning'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="alert__icon" aria-hidden="true">
        !
      </span>
      <span>{children}</span>
    </div>
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1)
  return letters.map((p) => p?.[0]?.toUpperCase() ?? '').join('') || '?'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date)
}

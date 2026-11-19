/**
 * Peças de UI compartilhadas pelos cards de integração (Notion, GitHub, ...).
 * Cada card monta seu fluxo de conexão; estado conectado/erro/desconectar é igual para todos.
 */
import { useId, useState, type FormEvent } from 'react'
import type { ConnectedAccount, ConnectionStatus } from '../../../../shared/ipc-contract'

/** O que está acontecendo agora, além do status persistido. */
export type ConnectionActivity =
  'loading' | 'idle' | 'connecting' | 'authorizing' | 'testing' | 'disconnecting'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' })

export function StatusBadge({
  status,
  activity,
  waitingLabel
}: {
  status: ConnectionStatus | null
  activity: ConnectionActivity
  /** Texto enquanto aguarda autorização no navegador (ex.: "Aguardando o Notion…"). */
  waitingLabel: string
}): React.JSX.Element | null {
  if (status === null) return null
  if (activity === 'testing') return <span className="badge">Verificando…</span>
  if (activity === 'authorizing') return <span className="badge">{waitingLabel}</span>
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

export interface TokenFormCopy {
  description: string
  label: string
  placeholder: string
  hint: string
  docsUrl: string
}

export function TokenForm({
  copy,
  error,
  connecting,
  onConnect
}: {
  copy: TokenFormCopy
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
      <p className="muted">{copy.description}</p>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="field">
        <div className="field__label-row">
          <label className="field__label" htmlFor={inputId}>
            {copy.label}
          </label>
          <button
            type="button"
            className="link-button"
            onClick={() => void window.orkio.openExternal(copy.docsUrl)}
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
          placeholder={copy.placeholder}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={connecting}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
        />
        <span className="field__hint" id={hintId}>
          {copy.hint}
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

export function ConnectedView({
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
  activity: ConnectionActivity
  lastVerifiedAt: Date | null
  onTest: () => Promise<void>
  onDisconnect: () => Promise<void>
}): React.JSX.Element {
  const busy = activity !== 'idle'
  const meta = [
    account.handle ? `@${account.handle}` : null,
    account.workspaceName ?? null,
    `Conectado em ${formatDate(connectedAt)}`
  ].filter(Boolean)
  return (
    <>
      <div className="account">
        <Avatar account={account} />
        <div>
          <div className="account__name">{account.userName}</div>
          <div className="account__meta">{meta.join(' · ')}</div>
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

export function StoredCredentialErrorView({
  message,
  activity,
  onRetry,
  onDisconnect,
  onReconnect,
  reconnectLabel
}: {
  message: string
  activity: ConnectionActivity
  onRetry: () => Promise<void>
  onDisconnect: () => Promise<void>
  /** Presente quando o build tem login OAuth do serviço. */
  onReconnect: (() => Promise<unknown>) | undefined
  reconnectLabel: string
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
            {reconnectLabel}
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

export function DisconnectButton({
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

export function Avatar({ account }: { account: ConnectedAccount }): React.JSX.Element {
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

export function Alert({
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

/** Volta para o fluxo principal a partir do formulário de token (ou avisa que não há OAuth). */
export function TokenFallbackFooter({
  oauthAvailable,
  connecting,
  primaryLabel,
  unavailableMessage,
  onBack
}: {
  oauthAvailable: boolean
  connecting: boolean
  primaryLabel: string
  unavailableMessage: string
  onBack: () => void
}): React.JSX.Element {
  return oauthAvailable ? (
    <button
      type="button"
      className="link-button link-button--muted"
      onClick={onBack}
      disabled={connecting}
    >
      ← Voltar para “{primaryLabel}”
    </button>
  ) : (
    <p className="field__hint">{unavailableMessage}</p>
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

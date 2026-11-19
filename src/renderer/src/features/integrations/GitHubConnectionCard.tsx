import { useEffect, useState } from 'react'
import {
  GITHUB_TOKEN_DOCS_URL,
  type ConnectionStatus,
  type DeviceFlowInfo
} from '../../../../shared/ipc-contract'
import {
  Alert,
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
    <section className="card" aria-labelledby="github-card-title" aria-busy={activity !== 'idle'}>
      <header className="card__header">
        <div className="card__icon" aria-hidden="true">
          <BranchMark />
        </div>
        <div>
          <h2 className="card__title" id="github-card-title">
            GitHub
          </h2>
          <p className="card__description">Código: repositórios, branches e PRs.</p>
        </div>
        <StatusBadge status={status} activity={activity} waitingLabel="Aguardando…" />
      </header>

      <div className="card__body" aria-live="polite">
        {status === null ? (
          <div className="skeleton" aria-label="Carregando status da conexão" />
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
          primaryLabel="Conectar com GitHub"
          unavailableMessage="O login com GitHub não está disponível nesta versão do Orkio."
          onBack={() => setUseToken(false)}
        />
      </>
    )
  }

  return (
    <>
      <p className="muted">
        Autorize o Orkio na sua conta do GitHub digitando um código no navegador. O Orkio pede
        acesso aos seus repositórios (escopo <code className="mono">repo</code>) para ler código e
        PRs e, mais tarde, abrir PRs.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="card__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void onStartDeviceFlow()}
        >
          {error ? 'Tentar novamente' : 'Conectar com GitHub'}
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
      <div className="authorizing" role="status">
        <span className="spinner" aria-hidden="true" />
        <div className="account__name">Pedindo um código ao GitHub…</div>
      </div>
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
    <>
      <p className="muted">
        Abra o GitHub, digite o código abaixo e clique em <strong>Authorize</strong>. O Orkio
        conecta sozinho assim que você autorizar.
      </p>
      <div className="device-code">
        <code className="device-code__value" aria-label={`Código: ${flow.userCode}`}>
          {flow.userCode}
        </code>
        <button type="button" className="button" onClick={() => void copyCode()}>
          {copy === 'copied' ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {copy === 'failed' && (
        <p className="field__hint">Não foi possível copiar. Selecione o código e copie à mão.</p>
      )}
      <div className="card__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void window.orkio.openExternal(flow.verificationUri)}
        >
          Abrir GitHub ↗
        </button>
        <button type="button" className="button" onClick={() => void onCancel()}>
          Cancelar
        </button>
        <span className="muted device-code__timer" role="timer">
          <span className="spinner" aria-hidden="true" />{' '}
          {remaining > 0
            ? `Aguardando · expira em ${formatRemaining(remaining)}`
            : 'Código expirado'}
        </span>
      </div>
    </>
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

/** Ícone genérico de branch (não usamos a marca do GitHub). */
function BranchMark(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M6 7v10M18 9c0 5-6 4-11.5 8.5" />
    </svg>
  )
}

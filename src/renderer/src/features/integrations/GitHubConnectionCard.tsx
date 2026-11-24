import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/Spinner'
import { ExternalLinkIcon, GitHubLogo } from '../../components/icons'
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
import type { UseGitHubConnection } from './useGitHubConnection'
import {
  GITHUB_TOKEN_DOCS_URL,
  type ConnectionStatus,
  type DeviceFlowInfo
} from '../../../../shared/connection'

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
    <section
      aria-labelledby="github-card-title"
      aria-busy={activity !== 'idle'}
      className={CONNECTION_CARD_CLASS}
    >
      <CardHeader
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

export function DeviceFlowView({
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
      <div role="status" className="flex items-center gap-2.5 text-sm text-foreground">
        <Spinner label="Aguardando" />
        Pedindo um código ao GitHub…
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Abra o GitHub, digite o código abaixo e clique em{' '}
        <span className="font-semibold text-foreground">Authorize</span>. O Orkio conecta sozinho
        assim que você autorizar.
      </p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface px-4 py-3">
        <span aria-label={`Código: ${flow.userCode}`} className="text-2xl tracking-[0.12em]">
          <code data-testid="device-code" className="font-mono font-medium text-foreground">
            {flow.userCode}
          </code>
        </span>
        <Button variant="outline" onClick={() => void copyCode()}>
          {copy === 'copied' ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      {copy === 'failed' && (
        <p className="text-xs text-muted-foreground">
          Não foi possível copiar. Selecione o código e copie à mão.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void window.orkio.openExternal(flow.verificationUri)}>
          <ExternalLinkIcon />
          Abrir GitHub
        </Button>
        <Button variant="outline" onClick={() => void onCancel()}>
          Cancelar
        </Button>
        <div className="flex items-center gap-2" role="timer">
          <Spinner label="Aguardando autorização" className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {remaining > 0
              ? `Aguardando · expira em ${formatRemaining(remaining)}`
              : 'Código expirado'}
          </span>
        </div>
      </div>
    </div>
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

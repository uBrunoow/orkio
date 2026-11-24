/**
 * Peças de UI compartilhadas pelos cards de integração (Notion, GitHub, ...).
 * Cada card monta seu fluxo de conexão; estado conectado/erro/desconectar é igual para todos.
 */
import { useState, type FormEvent } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { StatusToken, toneOf } from '../../components/StatusToken'
import { Alert } from '../../components/Alert'
import type { ConnectedAccount, ConnectionStatus } from '../../../../shared/connection'

export { Alert }

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
  const token = (
    label: string,
    color: 'default' | 'green' | 'yellow' | 'red'
  ): React.JSX.Element => <StatusToken label={label} tone={toneOf(color)} data-status={label} />
  if (activity === 'testing') return token('Verificando…', 'default')
  if (activity === 'authorizing') return token(waitingLabel, 'default')
  switch (status.state) {
    case 'connected':
      return status.warning
        ? token('Conectado (sem verificação)', 'yellow')
        : token('Conectado', 'green')
    case 'connecting':
      return token('Conectando…', 'default')
    case 'error':
      return token('Erro', 'red')
    case 'disconnected':
      return token('Desconectado', 'default')
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

  async function submit(): Promise<void> {
    if (connecting || token.trim() === '') return
    const result = await onConnect(token)
    // Não mantemos o token na memória da UI depois de conectar.
    if (result.state === 'connected') setToken('')
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col gap-1.5">
        <Field label={copy.label} description={copy.hint}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={copy.placeholder}
              autoComplete="off"
              spellCheck={false}
              disabled={connecting}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              // Tokens em fonte mono (BRAND.md).
              className="font-mono"
            />
          )}
        </Field>
        <Button
          type="button"
          variant="link"
          className="self-start text-xs"
          onClick={() => void window.orkio.openExternal(copy.docsUrl)}
        >
          Como criar um token ↗
        </Button>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={connecting || token.trim() === ''}>
          {connecting && <Spinner />}
          {error ? 'Tentar novamente' : 'Conectar'}
        </Button>
      </div>
    </form>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-8 rounded-lg">
          {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt="" />}
          <AvatarFallback className="rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
            {initials(account.userName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{account.userName}</span>
          <span className="truncate text-xs text-muted-foreground">{meta.join(' · ')}</span>
        </div>
      </div>
      {warning && <Alert tone="warning">{warning}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void onTest()} disabled={busy}>
          {activity === 'testing' && <Spinner />}
          {activity === 'testing' ? 'Testando…' : 'Testar conexão'}
        </Button>
        <DisconnectButton
          busy={busy}
          disconnecting={activity === 'disconnecting'}
          onConfirm={onDisconnect}
        />
        {lastVerifiedAt && !warning && activity === 'idle' && (
          <span className="text-xs text-muted-foreground">
            Verificado às {timeFormatter.format(lastVerifiedAt)}
          </span>
        )}
      </div>
    </div>
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
    <div className="flex flex-col gap-4">
      <Alert tone="danger">{message}</Alert>
      <p className="text-sm text-muted-foreground">
        {onReconnect
          ? 'Reconecte para autorizar o Orkio de novo, ou desconecte para remover a conexão.'
          : 'Se o token foi revogado, desconecte e conecte de novo com um token novo.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {onReconnect && (
          <Button onClick={() => void onReconnect()} disabled={busy}>
            {reconnectLabel}
          </Button>
        )}
        <Button variant="outline" onClick={() => void onRetry()} disabled={busy}>
          {activity === 'testing' && <Spinner />}
          {activity === 'testing' ? 'Testando…' : 'Tentar novamente'}
        </Button>
        <DisconnectButton
          busy={busy}
          disconnecting={activity === 'disconnecting'}
          onConfirm={onDisconnect}
        />
      </div>
    </div>
  )
}

/** Confirmação inline (sem diálogo). */
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
      // Vermelho só na confirmação: a ação ainda não aconteceu.
      <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
        Desconectar
      </Button>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Confirmar desconexão"
    >
      <span className="text-sm text-foreground">Remover a conexão deste computador?</span>
      <Button variant="outline" onClick={() => setConfirming(false)} disabled={disconnecting}>
        Cancelar
      </Button>
      <Button
        variant="destructive"
        disabled={disconnecting}
        onClick={() => void onConfirm().finally(() => setConfirming(false))}
      >
        {disconnecting && <Spinner />}
        {disconnecting ? 'Desconectando…' : 'Desconectar'}
      </Button>
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
    <div className="flex">
      <Button variant="ghost" size="sm" onClick={onBack} disabled={connecting}>
        ← Voltar para “{primaryLabel}”
      </Button>
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">{unavailableMessage}</p>
  )
}

/** Cabeçalho comum dos cards: ícone, título/descrição e status. */
export function CardHeader({
  titleId,
  title,
  description,
  icon,
  badge
}: {
  titleId: string
  title: string
  description: string
  icon: React.ReactNode
  badge: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border-soft bg-muted text-foreground">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 id={titleId} className="text-sm font-medium text-foreground">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {/* O status mantém o tamanho natural (não é truncado). */}
      <div className="shrink-0">{badge}</div>
    </div>
  )
}

/** Caixa dos cards de conexão: borda fina, fundo de card (região nomeada pelo título). */
export const CONNECTION_CARD_CLASS =
  'flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-4'

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date)
}

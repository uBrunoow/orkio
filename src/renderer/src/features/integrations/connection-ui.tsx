/**
 * Peças de UI compartilhadas pelos cards de integração (Notion, GitHub, ...), em Astryx.
 * Cada card monta seu fluxo de conexão; estado conectado/erro/desconectar é igual para todos.
 */
import { useState, type FormEvent } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Item } from '@astryxdesign/core/Item'
import { Link } from '@astryxdesign/core/Link'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { StackItem } from '@astryxdesign/core/Stack'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { ConnectedAccount, ConnectionStatus } from '../../../../shared/ipc-contract'
import { Alert } from '../../components/Alert'

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
  const token = (label: string, color: 'default' | 'green' | 'yellow' | 'red') => (
    <Token label={label} color={color} size="sm" data-status={label} />
  )
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
    <VStack
      as="form"
      gap={4}
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Text color="secondary">{copy.description}</Text>
      {error && <Alert tone="danger">{error}</Alert>}
      <VStack gap={1}>
        <TextInput
          type="password"
          label={copy.label}
          value={token}
          onChange={(value) => setToken(value)}
          placeholder={copy.placeholder}
          description={copy.hint}
          autoComplete="off"
          hasSpellCheck={false}
          isDisabled={connecting}
          // Tokens em fonte mono (BRAND.md): classe da camada da marca, com token do tema.
          controlClassName="orkio-mono-input"
          {...(error ? { status: { type: 'error' as const } } : {})}
        />
        <Link
          label="Como criar um token"
          onClick={() => void window.orkio.openExternal(copy.docsUrl)}
        >
          Como criar um token ↗
        </Link>
      </VStack>
      <HStack gap={2}>
        <Button
          type="submit"
          variant="primary"
          label={error ? 'Tentar novamente' : 'Conectar'}
          isLoading={connecting}
          isDisabled={!connecting && token.trim() === ''}
        />
      </HStack>
    </VStack>
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
    <VStack gap={4}>
      <Item
        startContent={
          <Avatar
            name={account.userName}
            size="md"
            {...(account.avatarUrl ? { src: account.avatarUrl } : {})}
          />
        }
        label={account.userName}
        description={meta.join(' · ')}
      />
      {warning && <Alert tone="warning">{warning}</Alert>}
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button
          label={activity === 'testing' ? 'Testando…' : 'Testar conexão'}
          onClick={() => void onTest()}
          isLoading={activity === 'testing'}
          isDisabled={busy && activity !== 'testing'}
        />
        <DisconnectButton
          busy={busy}
          disconnecting={activity === 'disconnecting'}
          onConfirm={onDisconnect}
        />
        {lastVerifiedAt && !warning && activity === 'idle' && (
          <Text type="supporting">Verificado às {timeFormatter.format(lastVerifiedAt)}</Text>
        )}
      </HStack>
    </VStack>
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
    <VStack gap={4}>
      <Alert tone="danger">{message}</Alert>
      <Text color="secondary">
        {onReconnect
          ? 'Reconecte para autorizar o Orkio de novo, ou desconecte para remover a conexão.'
          : 'Se o token foi revogado, desconecte e conecte de novo com um token novo.'}
      </Text>
      <HStack gap={2} wrap="wrap">
        {onReconnect && (
          <Button
            variant="primary"
            label={reconnectLabel}
            onClick={() => void onReconnect()}
            isDisabled={busy}
          />
        )}
        <Button
          label={activity === 'testing' ? 'Testando…' : 'Tentar novamente'}
          onClick={() => void onRetry()}
          isLoading={activity === 'testing'}
          isDisabled={busy && activity !== 'testing'}
        />
        <DisconnectButton
          busy={busy}
          disconnecting={activity === 'disconnecting'}
          onConfirm={onDisconnect}
        />
      </HStack>
    </VStack>
  )
}

/** Confirmação inline (sem diálogo: camadas sobrepostas da Astryx injetam <style>). */
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
      <Button
        // Vermelho só na confirmação: a ação ainda não aconteceu.
        variant="ghost"
        label="Desconectar"
        onClick={() => setConfirming(true)}
        isDisabled={busy}
      />
    )
  }

  return (
    <HStack gap={2} vAlign="center" role="group" aria-label="Confirmar desconexão">
      <Text>Remover a conexão deste computador?</Text>
      <Button label="Cancelar" onClick={() => setConfirming(false)} isDisabled={disconnecting} />
      <Button
        variant="destructive"
        label={disconnecting ? 'Desconectando…' : 'Desconectar'}
        isLoading={disconnecting}
        onClick={() => void onConfirm().finally(() => setConfirming(false))}
      />
    </HStack>
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
    <HStack>
      <Button
        variant="ghost"
        size="sm"
        label={`← Voltar para “${primaryLabel}”`}
        onClick={onBack}
        isDisabled={connecting}
      />
    </HStack>
  ) : (
    <Text type="supporting">{unavailableMessage}</Text>
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
    <HStack gap={3} vAlign="center">
      {icon}
      <StackItem size="fill">
        <VStack gap={0}>
          <Text as="h2" id={titleId} type="large" weight="semibold">
            {title}
          </Text>
          <Text type="supporting">{description}</Text>
        </VStack>
      </StackItem>
      {/* O status mantém o tamanho natural (não é truncado). */}
      <StackItem>{badge}</StackItem>
    </HStack>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date)
}

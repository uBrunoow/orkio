import { useEffect, useState } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Button } from '@astryxdesign/core/Button'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Item } from '@astryxdesign/core/Item'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { ConnectionStatus } from '../../../shared/ipc-contract'
import { SwitchIcon } from '../components/icons'

/**
 * Quem está usando o Orkio. Não existe login no app: a pessoa é a conta conectada do GitHub (nome,
 * login e foto) e, sem GitHub, a do Notion. Nada de e-mail. Relê ao voltar para a janela e quando
 * `refreshKey` muda (ex.: depois de conectar em Integrações).
 */
export interface Account {
  name: string
  /** "@login" no GitHub ou o workspace do Notion. */
  detail: string | null
  avatarUrl: string | null
}

function fromStatus(s: ConnectionStatus | null, kind: 'github' | 'notion'): Account | null {
  if (s?.state !== 'connected') return null
  const a = s.account
  return {
    name: a.userName,
    detail:
      kind === 'github' ? (a.handle ? `@${a.handle}` : 'GitHub') : (a.workspaceName ?? 'Notion'),
    avatarUrl: a.avatarUrl ?? null
  }
}

export function useAccount(refreshKey: number): Account | null {
  const [account, setAccount] = useState<Account | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void Promise.all([
        window.orkio.github.getStatus().catch(() => null),
        window.orkio.notion.getStatus().catch(() => null)
      ]).then(([github, notion]) => {
        if (alive) setAccount(fromStatus(github, 'github') ?? fromStatus(notion, 'notion'))
      })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [refreshKey])
  return account
}

function accountAvatar(account: Account, size: 'sm' | 'md'): React.JSX.Element {
  return (
    <Avatar
      name={account.name}
      size={size}
      shape="rounded"
      tooltip={false}
      {...(account.avatarUrl ? { src: account.avatarUrl } : {})}
    />
  )
}

/**
 * Conta na lateral (rodapé, como no Alva Tasks: avatar, nome e login) e no canto da barra (só o
 * avatar). Os dois abrem o mesmo menu: contas conectadas e configurações.
 */
export function AccountMenu({
  account,
  variant,
  onOpenIntegrations,
  onOpenSettings,
  onSignOut
}: {
  account: Account | null
  variant: 'row' | 'avatar'
  onOpenIntegrations(): void
  onOpenSettings(): void
  /** "Sair": desconecta GitHub e Notion (não há login próprio no Orkio). */
  onSignOut(): Promise<void>
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const items = [
    { label: 'Contas e integrações', onClick: onOpenIntegrations },
    { label: 'Configurações', onClick: onOpenSettings }
  ]
  if (!account) {
    return variant === 'row' ? (
      <Item
        density="compact"
        label="Conectar sua conta"
        description="GitHub ou Notion"
        onClick={onOpenIntegrations}
      />
    ) : (
      <></>
    )
  }
  if (variant === 'avatar') {
    return (
      <DropdownMenu
        button={{
          label: `Conta: ${account.name}`,
          isIconOnly: true,
          variant: 'ghost',
          size: 'sm',
          icon: accountAvatar(account, 'sm')
        }}
        placement="below"
        alignment="end"
        items={items}
      />
    )
  }
  return (
    <VStack gap={2}>
      <DropdownMenu
        placement="above"
        items={[
          ...items,
          { label: 'Sair…', variant: 'destructive', onClick: () => setConfirming(true) }
        ]}
        renderTrigger={(props) => (
          // Linha inteira como gatilho (Alva Tasks): avatar, nome e login à esquerda, seta à direita.
          <HStack
            as="button"
            {...props}
            aria-label={`Conta: ${account.name}. Abrir menu da conta`}
            gap={2}
            vAlign="center"
            width="100%"
            paddingInline={2}
            paddingBlock={1.5}
          >
            {accountAvatar(account, 'md')}
            <StackItem size="fill">
              <VStack hAlign="start">
                <Text maxLines={1}>{account.name}</Text>
                {account.detail && (
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {account.detail}
                  </Text>
                )}
              </VStack>
            </StackItem>
            <Icon icon={SwitchIcon} size="sm" color="secondary" />
          </HStack>
        )}
      />
      {confirming && (
        <VStack gap={2} role="group" aria-label="Confirmar saída" paddingInline={2}>
          <Text type="supporting">
            Desconectar o GitHub e o Notion deste computador? Os tokens são apagados; projetos e
            quadros ficam.
          </Text>
          <HStack gap={2}>
            <Button size="sm" label="Cancelar" onClick={() => setConfirming(false)} />
            <Button
              size="sm"
              variant="destructive"
              label="Sair"
              isLoading={leaving}
              onClick={() => {
                setLeaving(true)
                void onSignOut().finally(() => {
                  setLeaving(false)
                  setConfirming(false)
                })
              }}
            />
          </HStack>
        </VStack>
      )}
    </VStack>
  )
}

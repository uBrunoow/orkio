import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { SwitchIcon } from '../components/icons'
import { initials } from '../lib/initials'
import { useConnectionStatus } from '../features/integrations/useConnection'
import type { ConnectionStatus } from '../../../shared/connection'

/**
 * Quem está usando o Orkio. Não existe login no app: a pessoa é a conta conectada do GitHub (nome,
 * login e foto) e, sem GitHub, a do Notion. Nada de e-mail. Vem das conexões do App (conectar em
 * Integrações ou nos Primeiros passos já atualiza; relidas ao voltar para a janela).
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

export function useAccount(): Account | null {
  const github = useConnectionStatus('github')
  const notion = useConnectionStatus('notion')
  return fromStatus(github, 'github') ?? fromStatus(notion, 'notion')
}

function AccountAvatar({
  account,
  small
}: {
  account: Account
  small?: boolean
}): React.JSX.Element {
  return (
    <Avatar className={cn('rounded-md', small ? 'size-6' : 'size-7')}>
      {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt="" />}
      <AvatarFallback className="rounded-md bg-brand-tint text-2xs font-semibold text-brand-tint-foreground">
        {initials(account.name)}
      </AvatarFallback>
    </Avatar>
  )
}

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
}): React.JSX.Element | null {
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  if (!account) {
    return variant === 'row' ? (
      <button
        type="button"
        onClick={onOpenIntegrations}
        className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
      >
        <span className="text-sm text-foreground">Conectar sua conta</span>
        <span className="text-xs text-muted-foreground">GitHub ou Notion</span>
      </button>
    ) : null
  }
  const menu = (
    <DropdownMenuContent
      side={variant === 'row' ? 'top' : 'bottom'}
      align={variant === 'row' ? 'start' : 'end'}
      className="w-56"
    >
      <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
        <span className="truncate text-sm">{account.name}</span>
        {account.detail && (
          <span className="truncate text-xs text-muted-foreground">{account.detail}</span>
        )}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onOpenIntegrations}>Contas e integrações</DropdownMenuItem>
      <DropdownMenuItem onSelect={onOpenSettings}>Configurações</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
        Sair…
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
  if (variant === 'avatar') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Conta: ${account.name}`}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <AccountAvatar account={account} small />
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Conta: ${account.name}. Abrir menu da conta`}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-sidebar-accent"
        >
          <AccountAvatar account={account} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm text-foreground">{account.name}</span>
            {account.detail && (
              <span className="truncate font-mono text-2xs text-subtle-foreground">
                {account.detail}
              </span>
            )}
          </span>
          <SwitchIcon className="size-3.5 text-subtle-foreground" />
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      {confirming && (
        <div
          role="group"
          aria-label="Confirmar saída"
          className="flex flex-col gap-2 rounded-md border border-danger-tint-border bg-danger-tint p-2.5"
        >
          <p className="text-xs text-foreground">
            Desconectar o GitHub e o Notion deste computador? Os tokens são apagados; projetos e
            quadros ficam.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={leaving}
              onClick={() => {
                setLeaving(true)
                void onSignOut().finally(() => {
                  setLeaving(false)
                  setConfirming(false)
                })
              }}
            >
              Sair
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

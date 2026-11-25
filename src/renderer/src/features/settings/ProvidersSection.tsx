import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SwitchField } from '@/components/form'
import { Spinner } from '@/components/Spinner'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { StatusToken } from '../../components/StatusToken'
import { ClaudeLogo } from '../../components/icons'
import { useSources } from '../../app/sources'
import type { SettingsSection } from '../../app/routes'
import { ipcCall, useSource } from '../../lib/ipc'
import { claudeLoginText, claudeStatusText } from '../../lib/status-text'
import { useClaudeStatus } from '../claude/useClaudeStatus'
import { SettingsCard } from './SettingsCard'

/** Configurações › Provedores e uso: o Claude Code deste computador e o medidor de uso. */
export function ProvidersSection({
  onOpenSection
}: {
  onOpenSection(section: SettingsSection): void
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader
        title="Provedores e uso"
        subtitle="Quem roda as tarefas e quanto da sua assinatura já foi usado."
      />
      <ClaudeProvider onOpenIntegrations={() => onOpenSection('integrations')} />
      <UsageMeterSection />
    </div>
  )
}

function ClaudeProvider({ onOpenIntegrations }: { onOpenIntegrations(): void }): React.JSX.Element {
  const claude = useClaudeStatus()
  const status = claude.status
  const [checking, setChecking] = useState(false)
  const check = async (): Promise<void> => {
    setChecking(true)
    await claude.check(true)
    setChecking(false)
  }
  return (
    <SettingsCard
      title="Claude Code"
      description="Executa as tarefas no seu computador, com a sua conta. É o único provedor por enquanto."
      action={<StatusToken {...claudeStatusText(status)} />}
    >
      <div className="flex items-start gap-3">
        <ClaudeLogo className="mt-0.5 size-5 shrink-0" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-xs text-muted-foreground">Versão</dt>
          <dd className="font-mono text-xs text-foreground">
            {status === null ? '…' : status.installed ? (status.version ?? '—') : 'Não instalado'}
          </dd>
          <dt className="text-xs text-muted-foreground">Login</dt>
          <dd>{status === null ? '…' : <StatusToken {...claudeLoginText(status)} />}</dd>
        </dl>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
          {checking && <Spinner />}
          Verificar de novo
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenIntegrations}>
          Instalar, entrar e plugins em Integrações
        </Button>
      </div>
    </SettingsCard>
  )
}

/**
 * Medidor de uso do Claude na barra (experimental, ligado por padrão). Lê a mesma fonte da barra:
 * mudar aqui some/aparece lá na hora.
 */
export function UsageMeterSection(): React.JSX.Element {
  const { claudeUsage } = useSources()
  const view = useSource(claudeUsage, '').value
  return (
    <SettingsCard title="Uso do Claude">
      <SwitchField
        label="Mostrar o uso do Claude na barra (experimental)"
        description="Quanto da janela de 5 horas e da semanal a sua assinatura já usou, e quando renovam. O Orkio lê do login do Claude Code neste computador, só na hora, sem guardar nada. Se a Anthropic mudar algo, o medidor some sozinho."
        checked={view?.enabled !== false}
        disabled={view === null}
        onChange={(value) => {
          claudeUsage.set('', (v) => (v ? { ...v, enabled: value } : v))
          void ipcCall(() => window.orkio.usage.setEnabled(value), !value).then(() =>
            claudeUsage.reload('')
          )
        }}
      />
    </SettingsCard>
  )
}

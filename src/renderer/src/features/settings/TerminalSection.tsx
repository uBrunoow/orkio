import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { formatKeys } from '../../app/keys'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingsCard } from './SettingsCard'

/**
 * Configurações › Terminal: como o terminal embutido funciona hoje (Fase 2). Só informação: nada
 * aqui que o main não aplique.
 */
export function TerminalSection({ isMac }: { isMac: boolean }): React.JSX.Element {
  const rows: { label: string; value: React.ReactNode; detail?: string }[] = [
    {
      label: 'Shell',
      value: 'O mesmo do seu sistema',
      detail: isMac
        ? 'O $SHELL da sua conta, com o seu perfil de login.'
        : 'O $SHELL da sua conta (com o perfil de login), ou PowerShell no Windows.'
    },
    {
      label: 'Pasta',
      value: 'Abre na pasta da tarefa',
      detail: 'O ambiente da tarefa (a cópia de trabalho do git), nunca a pasta principal.'
    },
    {
      label: 'Quantos ao mesmo tempo',
      value: 'Até 8 abertos, 4 por tarefa',
      detail: 'Os que terminam ficam para ler até você fechar.'
    },
    {
      label: 'Abrir',
      value: <Kbd>{formatKeys('mod+shift+j', isMac)}</Kbd>,
      detail: 'Na tela da tarefa, ou “Terminal no Orkio” no painel Ambiente.'
    }
  ]
  return (
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader
        title="Terminal"
        subtitle="O terminal dentro do Orkio, um por tarefa. Ainda não tem opções para mudar."
      />
      <SettingsCard title="Como funciona">
        <dl className="flex flex-col divide-y divide-border-soft">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
            >
              <dt className="w-44 shrink-0 text-xs text-muted-foreground">{r.label}</dt>
              <dd className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm text-foreground">{r.value}</span>
                {r.detail && <span className="text-xs text-subtle-foreground">{r.detail}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsCard>
      <SettingsCard
        title="Sair do terminal com a sessão"
        description="“Continuar no Claude” abre a conversa da tarefa num terminal. Lá valem as configurações do seu Claude Code, não as do Orkio."
      />
    </div>
  )
}

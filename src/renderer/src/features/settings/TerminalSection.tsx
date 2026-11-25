import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { formatKeys } from '../../app/keys'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingRow, SettingsGroup } from '../../components/SettingRows'
import { ClaudeLogo, TerminalIcon } from '../../components/icons'

/**
 * Configurações › Terminal: como o terminal embutido funciona hoje (Fase 2), no jeito das outras
 * telas: uma prévia no topo e linhas. Só informação: nada aqui que o main não aplique.
 */
export function TerminalSection({ isMac }: { isMac: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <PageHeader
        title="Terminal"
        subtitle="O terminal dentro do Orkio, na pasta de cada tarefa. Ainda não tem opções para mudar."
      />

      <Preview />

      <SettingsGroup title="Como funciona">
        <SettingRow
          label="Shell"
          description={
            isMac
              ? 'O $SHELL da sua conta, com o seu perfil de login.'
              : 'O $SHELL da sua conta (com o perfil de login), ou PowerShell no Windows.'
          }
        >
          <span className="text-sm text-foreground">O mesmo do seu sistema</span>
        </SettingRow>
        <SettingRow
          label="Pasta"
          description="A cópia de trabalho do git da tarefa, nunca a pasta principal."
          help="Na tela Terminais (Ctrl/⌘ 5), a pasta do projeto atual."
        >
          <span className="text-sm text-foreground">A da tarefa</span>
        </SettingRow>
        <SettingRow
          label="Quantos ao mesmo tempo"
          description="Os que terminam ficam para ler até você fechar."
        >
          <span className="text-sm text-foreground tabular-nums">8 abertos · 4 por tarefa</span>
        </SettingRow>
        <SettingRow label="Fonte e cores" description="A fonte de código e o tema de Aparência.">
          <span className="text-sm text-muted-foreground">Seguem a Aparência</span>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Atalhos">
        <SettingRow
          label="Terminal da tarefa"
          description="Na tela da tarefa, ou “Terminal no Orkio” no painel Ambiente."
        >
          <Kbd>{formatKeys('mod+shift+j', isMac)}</Kbd>
        </SettingRow>
        <SettingRow label="Tela Terminais" description="Shell na pasta do projeto atual.">
          <Kbd>{formatKeys('mod+5', isMac)}</Kbd>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Sair do terminal com a sessão">
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-claude text-white"
          >
            <ClaudeLogo className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-foreground">Continuar no Claude</span>
            <p className="text-xs text-muted-foreground">
              Abre a conversa da tarefa num terminal e a tarefa fica com você até devolver. Lá valem
              as configurações do seu Claude Code, não as do Orkio.
            </p>
          </div>
        </div>
      </SettingsGroup>
    </div>
  )
}

/** Prévia de como o terminal aparece: a fonte de código e as cores do tema atual. */
function Preview(): React.JSX.Element {
  return (
    <figure
      aria-label="Prévia do terminal"
      className="overflow-hidden rounded-xl border border-border-soft bg-card"
    >
      <div className="flex items-center gap-2 border-b border-border-soft bg-surface/60 px-3 py-2">
        <TerminalIcon aria-hidden="true" className="size-3.5 text-subtle-foreground" />
        <span className="text-xs text-muted-foreground">shell</span>
        <span className="ml-auto font-mono text-2xs text-subtle-foreground">ORK-142</span>
      </div>
      <pre
        aria-hidden="true"
        className="overflow-x-auto bg-background px-4 py-3 font-mono text-xs leading-relaxed text-foreground"
      >
        <span className="text-ok">~/worktrees/orkio-app/ORK-142</span>{' '}
        <span className="text-brand">feat/ORK-142-sync-notion</span>
        {'\n'}
        <span className="text-subtle-foreground">$</span> git status --short
        {'\n'}
        <span className="text-warn"> M</span> src/notion/sync.ts
        {'\n'}
        <span className="text-ok">?? </span>src/notion/sync.test.ts
        {'\n'}
        <span className="text-subtle-foreground">$</span>{' '}
        <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-foreground/80" />
      </pre>
    </figure>
  )
}

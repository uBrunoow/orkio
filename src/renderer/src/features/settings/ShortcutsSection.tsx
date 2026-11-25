import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { GLOBAL_SHORTCUTS, type GlobalShortcut } from '../../../../shared/preferences'
import { APP_COMMANDS, MENUS, commandLabel, type CommandState } from '../../app/commands'
import { formatKeys } from '../../app/keys'
import { Alert } from '../../components/Alert'
import { ChoiceCards, type ChoiceCard } from '../../components/ChoiceCards'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingsCard } from './SettingsCard'
import { globalShortcutText } from './shortcut-text'
import { usePreferences } from './usePreferences'

type GlobalChoice = GlobalShortcut | 'off'

/** Estado neutro só para os rótulos que dependem do app ("Esconder"/"Mostrar"). */
function labelState(isMac: boolean): CommandState {
  return {
    isMac,
    route: null,
    hasProject: true,
    projectCount: 1,
    tabCount: 1,
    canBack: false,
    canReopen: false,
    sidebarOpen: true,
    usageMeter: true,
    waiting: 0,
    notionConnected: true,
    githubConnected: true
  }
}

/**
 * Configurações › Atalhos: o atalho global (trazer o Orkio para a frente, aplicado pelo main) e a
 * lista dos atalhos do app, da mesma fonte da Ajuda › Atalhos (`APP_COMMANDS`). Só leitura.
 */
export function ShortcutsSection({ isMac }: { isMac: boolean }): React.JSX.Element {
  const { prefs, error, save } = usePreferences()
  const ctx = labelState(isMac)
  const options: ChoiceCard<GlobalChoice>[] = [
    { value: 'off', title: 'Desligado', phrase: 'Nenhum atalho fora do app.' },
    ...GLOBAL_SHORTCUTS.map((s) => ({
      value: s,
      title: globalShortcutText(s, isMac),
      phrase: 'Traz o Orkio para a frente de qualquer app.',
      hint: s
    }))
  ]
  const groups = MENUS.map((m) => ({
    label: m.label,
    items: APP_COMMANDS.filter((c) => c.keys && (c.menu ?? 'go') === m.id)
  })).filter((g) => g.items.length > 0)

  return (
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader title="Atalhos" subtitle="Teclas para ir mais rápido." />
      {error && <Alert tone="danger">{error}</Alert>}

      <SettingsCard
        title="Atalho global"
        description="Funciona mesmo com outro app na frente. Se outro programa já usa a combinação, escolha outra."
      >
        <ChoiceCards
          label="Atalho global"
          columns={2}
          value={prefs?.globalShortcut ?? 'off'}
          disabled={prefs === null}
          options={options}
          onChange={(v) => void save({ globalShortcut: v === 'off' ? null : v })}
        />
      </SettingsCard>

      <SettingsCard
        title="Atalhos do app"
        description={`Num campo de texto só valem os atalhos com ${isMac ? '⌘' : 'Ctrl'}. No Quadro: J/K ou setas andam entre os cards, M abre o menu do card e ${formatKeys('mod+enter', isMac)} abre a tarefa.`}
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="flex flex-col gap-1.5">
              <h3 className="text-2xs tracking-wider text-subtle-foreground uppercase">
                {g.label}
              </h3>
              <ul className="flex flex-col gap-1">
                {g.items.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{commandLabel(c, ctx)}</span>
                    <Kbd>{formatKeys(c.keys!, isMac)}</Kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SettingsCard>
    </div>
  )
}

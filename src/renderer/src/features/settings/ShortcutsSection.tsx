import { useId, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Select } from '@/components/ui/select'
import { GLOBAL_SHORTCUTS, type GlobalShortcut } from '../../../../shared/preferences'
import { normalizeLabel } from '../../../../shared/text'
import { APP_COMMANDS, MENUS, shortcutRows, type CommandState } from '../../app/commands'
import { formatKeys } from '../../app/keys'
import { Alert } from '../../components/Alert'
import { SearchIcon } from '../../components/icons'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingRow, SettingsGroup } from '../../components/SettingRows'
import { SURFACE } from '../../components/surface'
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

interface ShortcutRow {
  id: string
  label: string
  /** Teclas já no texto da plataforma; a primeira é a principal. */
  keys: string[]
  where: string
  /** Sem Ctrl/⌘: não vale com o cursor num campo de texto. */
  outsideFields: boolean
}

const hasModifier = (keys: string): boolean => /^(mod|ctrl|alt)\+/.test(keys)

/** Linhas da tabela: o registro de comandos (`APP_COMMANDS`) + as teclas do Quadro. */
function shortcutTable(isMac: boolean): ShortcutRow[] {
  const ctx = labelState(isMac)
  const byId = new Map(APP_COMMANDS.map((c) => [c.id, c]))
  const rows: ShortcutRow[] = MENUS.flatMap((m) =>
    shortcutRows(APP_COMMANDS, m.id, ctx).map((r) => {
      const c = byId.get(r.id)
      const raw = c?.shortcutRow ? c.shortcutRow.keys : (c?.keys ?? '')
      return {
        id: r.id,
        label: r.label,
        keys: [r.keys, ...(c?.altKeys ?? []).map((k) => formatKeys(k, isMac))],
        where: m.label,
        outsideFields: raw !== '' && !hasModifier(raw)
      }
    })
  )
  const board: ShortcutRow[] = [
    {
      id: 'board.next',
      label: 'Próximo card',
      keys: ['J', '↓'],
      where: 'Quadro',
      outsideFields: true
    },
    {
      id: 'board.prev',
      label: 'Card anterior',
      keys: ['K', '↑'],
      where: 'Quadro',
      outsideFields: true
    },
    { id: 'board.menu', label: 'Menu do card', keys: ['M'], where: 'Quadro', outsideFields: true },
    {
      id: 'board.open',
      label: 'Abrir a tarefa',
      keys: [formatKeys('mod+enter', isMac)],
      where: 'Quadro',
      outsideFields: false
    }
  ]
  return [...rows, ...board]
}

/**
 * Configurações › Atalhos (no jeito do Compozy): uma tabela só com comando, tecla e onde vale, com
 * busca; embaixo, o atalho global (trazer o Orkio para a frente, aplicado pelo main). As teclas do
 * app vêm do registro (`APP_COMMANDS`), a mesma fonte da Ajuda › Atalhos; não se trocam aqui.
 */
export function ShortcutsSection({ isMac }: { isMac: boolean }): React.JSX.Element {
  const { prefs, error, save } = usePreferences()
  const [query, setQuery] = useState('')
  const globalId = useId()
  const all = useMemo(() => shortcutTable(isMac), [isMac])
  const q = normalizeLabel(query)
  const rows = q
    ? all.filter((r) =>
        normalizeLabel(`${r.label} ${r.id} ${r.where} ${r.keys.join(' ')}`).includes(q)
      )
    : all
  const globalOptions = [
    { value: 'off', label: 'Desligado' },
    ...GLOBAL_SHORTCUTS.map((s) => ({ value: s, label: globalShortcutText(s, isMac) }))
  ]

  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <PageHeader title="Atalhos" subtitle="Teclas para ir mais rápido. Valem na hora." />
      {error && <Alert tone="danger">{error}</Alert>}

      <SettingsGroup
        bare
        title="Atalhos do app"
        description={`Os sem ${isMac ? '⌘' : 'Ctrl'} não valem com o cursor num campo de texto.`}
      >
        <div className={cn(SURFACE.list, '@container')}>
          <div className="flex items-center gap-3 border-b border-border-soft px-3 py-2">
            <div className="relative w-full max-w-72">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input
                type="search"
                aria-label="Buscar atalho"
                placeholder="Buscar por comando ou tecla"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    e.stopPropagation()
                    setQuery('')
                  }
                }}
                className="h-7 pl-7 text-xs"
              />
            </div>
            <span className="ml-auto text-xs text-subtle-foreground tabular-nums">
              {rows.length === all.length
                ? `${all.length} atalhos`
                : `${rows.length} de ${all.length}`}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum atalho com “{query}”.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Comando
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Atalho
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-normal @max-[34rem]:hidden">
                    Onde
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <div className="text-foreground">{r.label}</div>
                      <div className="font-mono text-2xs text-subtle-foreground">{r.id}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.keys.map((k, i) => (
                          <Kbd
                            key={k}
                            className={cn(
                              'h-6 rounded-full px-2.5',
                              i > 0 &&
                                'bg-transparent text-muted-foreground ring-1 ring-border-soft'
                            )}
                          >
                            {k}
                          </Kbd>
                        ))}
                      </div>
                      {r.outsideFields && (
                        <p className="mt-1 text-2xs text-subtle-foreground">
                          Fora de campos de texto
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground @max-[34rem]:hidden">
                      {r.where}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Atalho global"
        description="Teclas físicas: em teclados fora do padrão QWERTY a letra impressa pode ser outra."
      >
        <SettingRow
          label="Trazer o Orkio para a frente"
          labelFor={globalId}
          description="Funciona mesmo com outro app na frente. Se outro programa já usa a combinação, escolha outra."
        >
          <Select
            id={globalId}
            aria-label="Atalho global"
            size="sm"
            options={globalOptions}
            value={prefs?.globalShortcut ?? 'off'}
            disabled={prefs === null}
            onChange={(v) =>
              void save({
                globalShortcut: v === 'off' ? null : (v as GlobalChoice as GlobalShortcut)
              })
            }
            className="w-44"
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}

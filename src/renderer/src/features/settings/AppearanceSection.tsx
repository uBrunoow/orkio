import { useId } from 'react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/form'
import { PictureChoices, type PictureChoice } from '../../components/ChoiceCards'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingRow, SettingsGroup, SwitchRow } from '../../components/SettingRows'
import {
  appearancePref,
  type Appearance,
  type CodeFont,
  type TextSize,
  type ThemePref,
  type Tracking,
  type UiFont,
  type Wallpaper
} from './appearance'

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' }
]

const TEXT_OPTIONS: { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Pequeno' },
  { value: 'normal', label: 'Padrão' },
  { value: 'large', label: 'Grande' },
  { value: 'larger', label: 'Maior' }
]

const TRACKING_OPTIONS: { value: Tracking; label: string }[] = [
  { value: 'tight', label: 'Justo' },
  { value: 'normal', label: 'Padrão' },
  { value: 'relaxed', label: 'Solto' },
  { value: 'wide', label: 'Largo' }
]

const UI_FONT_OPTIONS: { value: UiFont; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'geist', label: 'Geist' },
  { value: 'figtree', label: 'Figtree' },
  { value: 'system', label: 'Do sistema' }
]

const CODE_FONT_OPTIONS: { value: CodeFont; label: string }[] = [
  { value: 'jetbrains', label: 'JetBrains Mono' },
  { value: 'geist-mono', label: 'Geist Mono' },
  { value: 'system', label: 'Do sistema' }
]

const WALLPAPER_OPTIONS: readonly PictureChoice<Wallpaper>[] = (
  [
    ['flat', 'Liso', 'Só a cor do fundo.'],
    ['ember', 'Brasa', 'Um brilho laranja discreto num canto.'],
    ['mesh', 'Malha', 'Luzes frias e suaves espalhadas.'],
    ['carbon', 'Carbono', 'Uma trama fina, como fibra.'],
    ['esmeralda', 'Esmeralda', 'Verde-água, com o fundo levemente frio.'],
    ['oceano', 'Oceano', 'Azul profundo, com luz no alto.'],
    ['orquidea', 'Orquídea', 'Rosa suave sobre um fundo arroxeado.'],
    ['dracula', 'Dracula', 'Roxo e ciano do tema de editor.'],
    ['nord', 'Nord', 'Gelo azulado e verde-musgo, do tema Nord.'],
    ['catppuccin', 'Catppuccin', 'Lilás e azul em tons pastel (Mocha / Latte).']
  ] as const
).map(([value, label, hint]) => ({
  value,
  label,
  hint,
  picture: <span data-preview={value} className="orkio-wallpaper-preview block h-full w-full" />
}))

/** Configurações › Aparência: só deste computador (`localStorage`), aplicada na hora. */
export function AppearanceSection(): React.JSX.Element {
  const appearance = appearancePref.use()
  const change = (patch: Partial<Appearance>): void =>
    appearancePref.save({ ...appearance, ...patch })
  const uiFontId = useId()
  const codeFontId = useId()

  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <PageHeader title="Aparência" subtitle="Como o Orkio aparece nesta tela." />

      <SettingsGroup title="Tema e movimento">
        <SettingRow
          label="Tema"
          help="Sistema acompanha o claro/escuro do seu computador, inclusive quando ele troca sozinho."
        >
          <SegmentedControl
            label="Tema"
            size="sm"
            value={appearance.theme}
            options={THEME_OPTIONS}
            onChange={(v) => change({ theme: v as ThemePref })}
          />
        </SettingRow>
        <SwitchRow
          label="Reduzir movimento"
          help="Desligado, o Orkio anima quando o sistema anima. Ligado, nada de animações nem transições."
          checked={appearance.motion === 'reduce'}
          onChange={(on) => change({ motion: on ? 'reduce' : 'system' })}
        />
      </SettingsGroup>

      <SettingsGroup title="Texto" description="Vale para todas as telas deste computador.">
        <SettingRow
          label="Interface"
          labelFor={uiFontId}
          help="A fonte dos menus, botões e textos."
        >
          <Select
            id={uiFontId}
            aria-label="Fonte da interface"
            size="sm"
            options={UI_FONT_OPTIONS}
            value={appearance.uiFont}
            onChange={(v) => change({ uiFont: v as UiFont })}
            className="w-48"
          />
        </SettingRow>
        <SettingRow
          label="Código"
          labelFor={codeFontId}
          help="A fonte de IDs, branches, comandos, diff e terminal."
        >
          <Select
            id={codeFontId}
            aria-label="Fonte do código"
            size="sm"
            options={CODE_FONT_OPTIONS}
            value={appearance.codeFont}
            onChange={(v) => change({ codeFont: v as CodeFont })}
            className="w-48 font-mono"
          />
        </SettingRow>
        <SettingRow
          label="Tamanho do texto"
          help="Aumenta o texto e os espaços da interface juntos."
        >
          <SegmentedControl
            label="Tamanho do texto"
            size="sm"
            value={appearance.text}
            options={TEXT_OPTIONS}
            onChange={(v) => change({ text: v as TextSize })}
          />
        </SettingRow>
        <SettingRow
          label="Espaço entre letras"
          help="Justo cabe mais por linha; Largo fica mais fácil de ler de longe."
        >
          <SegmentedControl
            label="Espaço entre letras"
            size="sm"
            value={appearance.tracking}
            options={TRACKING_OPTIONS}
            onChange={(v) => change({ tracking: v as Tracking })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        bare
        title="Fundo"
        description="Atrás das telas, sem tirar contraste do texto. Combina com o tema claro e o escuro."
      >
        <PictureChoices
          label="Fundo"
          value={appearance.wallpaper}
          options={WALLPAPER_OPTIONS}
          onChange={(wallpaper) => change({ wallpaper })}
        />
      </SettingsGroup>
    </div>
  )
}

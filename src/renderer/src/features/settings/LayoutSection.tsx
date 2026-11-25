import { cn } from '@/lib/utils'
import { PictureChoices, type PictureChoice } from '../../components/ChoiceCards'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingRow, SettingsGroup } from '../../components/SettingRows'
import { ARRANGEMENTS, type Arrangement } from '../../app/desktops'
import {
  layoutPref,
  type DesktopTransition,
  type FocusMode,
  type LayoutPrefs,
  type PageWidth,
  type PanelGap
} from './layout-prefs'
import {
  ArrangementPicture,
  FocusPicture,
  GapPicture,
  PageWidthPicture,
  TransitionPicture
} from './LayoutPictures'

const ARRANGEMENT_OPTIONS: readonly PictureChoice<Arrangement>[] = ARRANGEMENTS.map((a) => ({
  value: a.id,
  label: a.label,
  hint: a.hint,
  picture: <ArrangementPicture arrangement={a.id} />
}))

const GAP_OPTIONS: readonly PictureChoice<PanelGap>[] = [
  { value: 'joined', label: 'Juntos', picture: <GapPicture spaced={false} /> },
  { value: 'spaced', label: 'Com respiro', picture: <GapPicture spaced /> }
]

const TRANSITION_OPTIONS: readonly PictureChoice<DesktopTransition>[] = [
  { value: 'slide', label: 'Deslizar', picture: <TransitionPicture kind="slide" /> },
  { value: 'fade', label: 'Esmaecer', picture: <TransitionPicture kind="fade" /> },
  { value: 'instant', label: 'Na hora', picture: <TransitionPicture kind="instant" /> }
]

const FOCUS_OPTIONS: readonly PictureChoice<FocusMode>[] = [
  { value: 'click', label: 'Ao clicar', picture: <FocusPicture hover={false} /> },
  { value: 'hover', label: 'Ao passar', picture: <FocusPicture hover /> }
]

const PAGE_WIDTH_OPTIONS: readonly PictureChoice<PageWidth>[] = [
  { value: 'centered', label: 'Centralizada', picture: <PageWidthPicture full={false} /> },
  { value: 'full', label: 'Largura toda', picture: <PageWidthPicture full /> }
]

/** Configurações › Layout: desktops, painéis lado a lado e páginas. Só deste computador. */
export function LayoutSection(): React.JSX.Element {
  const layout = layoutPref.use()
  const change = (patch: Partial<LayoutPrefs>): void => layoutPref.save({ ...layout, ...patch })

  return (
    <div className={cn('flex flex-col gap-7', PAGE_WIDTH.form)}>
      <PageHeader
        title="Layout"
        subtitle="Como desktops, painéis e páginas se arrumam na janela. Vale na hora."
      />

      <SettingsGroup
        title="Desktops"
        description="Cada desktop guarda as próprias abas e o próprio arranjo."
      >
        <SettingRow
          label="Desktop novo começa em"
          help="O arranjo de um desktop criado agora. Os que já existem não mudam; troque pelo menu de arranjo na barra de abas."
          stack
        >
          <PictureChoices
            label="Desktop novo começa em"
            size="sm"
            value={layout.newDesktop}
            options={ARRANGEMENT_OPTIONS}
            onChange={(newDesktop) => change({ newDesktop })}
          />
        </SettingRow>
        <SettingRow
          label="Ao trocar de desktop"
          help="Deslizar vem do lado do desktop escolhido. Com Reduzir movimento, a troca é sempre na hora."
        >
          <PictureChoices
            label="Ao trocar de desktop"
            size="sm"
            value={layout.transition}
            options={TRANSITION_OPTIONS}
            onChange={(transition) => change({ transition })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Painéis lado a lado"
        description="Quando o desktop mostra mais de uma aba ao mesmo tempo."
      >
        <SettingRow
          label="Espaço entre painéis"
          help="Juntos separa por uma linha fina. Com respiro, cada painel ganha margem e cantos, e o fundo escolhido em Aparência aparece entre eles."
        >
          <PictureChoices
            label="Espaço entre painéis"
            size="sm"
            value={layout.gap}
            options={GAP_OPTIONS}
            onChange={(gap) => change({ gap })}
          />
        </SettingRow>
        <SettingRow
          label="Painel em foco"
          help="Ao passar, apontar para um painel já o torna o ativo (os atalhos e o menu Janela agem nele)."
        >
          <PictureChoices
            label="Painel em foco"
            size="sm"
            value={layout.focus}
            options={FOCUS_OPTIONS}
            onChange={(focus) => change({ focus })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Páginas"
        description="Configurações, Projetos, Integrações e outras telas de leitura."
      >
        <SettingRow
          label="Largura das páginas"
          help="Centralizada mantém as linhas confortáveis de ler, com espaço dos lados. Largura toda usa a janela inteira."
        >
          <PictureChoices
            label="Largura das páginas"
            size="sm"
            value={layout.pageWidth}
            options={PAGE_WIDTH_OPTIONS}
            onChange={(pageWidth) => change({ pageWidth })}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChoiceCards, type ChoiceCard } from '../../components/ChoiceCards'
import { PageHeader } from '../../components/PageHeader'
import { PAGE_WIDTH } from '../../components/page-width'
import { SettingsCard } from './SettingsCard'
import {
  readAppearance,
  saveAppearance,
  type Appearance,
  type MotionPref,
  type TextSize
} from './appearance'

const MOTION_OPTIONS: readonly ChoiceCard<MotionPref>[] = [
  {
    value: 'system',
    title: 'Seguir o sistema',
    phrase: 'Anima quando o sistema anima; reduz quando ele pede menos movimento.',
    hint: 'prefers-reduced-motion do sistema.'
  },
  {
    value: 'reduce',
    title: 'Reduzir sempre',
    phrase: 'Sem animações nem transições, qualquer que seja o sistema.'
  }
]

const TEXT_OPTIONS: readonly ChoiceCard<TextSize>[] = [
  { value: 'normal', title: 'Normal', phrase: 'O tamanho de sempre.' },
  { value: 'large', title: 'Grande', phrase: 'Um pouco maior, com mais espaço.' },
  { value: 'larger', title: 'Maior', phrase: 'Bem maior. Cabe menos na janela.' }
]

/** Configurações › Aparência: só deste computador (`localStorage`), aplicada na hora. */
export function AppearanceSection(): React.JSX.Element {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance)
  const change = (patch: Partial<Appearance>): void => {
    const next = { ...appearance, ...patch }
    setAppearance(next)
    saveAppearance(next)
  }
  return (
    <div className={cn('flex flex-col gap-6', PAGE_WIDTH.form)}>
      <PageHeader title="Aparência" subtitle="Como o Orkio aparece nesta tela." />

      <SettingsCard
        title="Tema"
        description="Por enquanto o Orkio tem só o tema escuro. Um tema claro ainda não existe."
      >
        <p className="text-sm text-foreground">Escuro</p>
      </SettingsCard>

      <SettingsCard title="Movimento" description="Animações de abrir, fechar e carregar.">
        <ChoiceCards
          label="Movimento"
          columns={2}
          value={appearance.motion}
          options={MOTION_OPTIONS}
          onChange={(motion) => change({ motion })}
        />
      </SettingsCard>

      <SettingsCard
        title="Tamanho do texto"
        description="Aumenta o texto e os espaços da interface juntos."
      >
        <ChoiceCards
          label="Tamanho do texto"
          value={appearance.text}
          options={TEXT_OPTIONS}
          onChange={(text) => change({ text })}
        />
      </SettingsCard>
    </div>
  )
}

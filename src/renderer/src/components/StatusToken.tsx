import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Text } from '@astryxdesign/core/Text'
import { DotIcon } from './icons'

/**
 * Estado único do app (mapa da skill orkio-design): ponto colorido + texto, nunca bloco.
 * - success: concluído, OK, aprovado
 * - warning: esperando você, falta configurar, não verificado
 * - danger: falhou, CI vermelho, alterações pedidas
 * - running: agente rodando (o único uso de laranja em estado)
 * - neutral: etapas, prioridade, o resto
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'running' | 'neutral'

const DOT_COLOR = {
  success: 'success',
  warning: 'warning',
  danger: 'error',
  running: 'accent',
  neutral: 'tertiary'
} as const

export function StatusToken({
  label,
  tone = 'neutral',
  ...rest
}: {
  label: string
  tone?: StatusTone
} & { [K in `data-${string}`]?: string }): React.JSX.Element {
  return (
    <HStack gap={1} vAlign="center" {...rest}>
      <Icon icon={DotIcon} size="sm" color={DOT_COLOR[tone]} />
      <Text type="supporting" color={tone === 'neutral' ? 'secondary' : 'primary'}>
        {label}
      </Text>
    </HStack>
  )
}

/** Ponte para mapas antigos que falam em cor de Token: converte para o estado do mapa único. */
export function toneOf(color: string | undefined): StatusTone {
  switch (color) {
    case 'green':
      return 'success'
    case 'yellow':
      return 'warning'
    case 'red':
      return 'danger'
    case 'orange':
      return 'running'
    default:
      return 'neutral'
  }
}

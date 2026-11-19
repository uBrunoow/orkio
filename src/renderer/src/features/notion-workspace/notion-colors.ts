import type { NotionColor } from '../../../../shared/ipc-contract'

export type TokenColor =
  'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray'

/** Cores de opção do Notion → cores de Token do tema (o Notion não tem teal/cyan; nós não temos marrom). */
const TOKEN_COLOR: Record<NotionColor, TokenColor> = {
  default: 'default',
  gray: 'gray',
  brown: 'orange',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  pink: 'pink',
  red: 'red'
}

export function tokenColor(color: NotionColor): TokenColor {
  return TOKEN_COLOR[color]
}

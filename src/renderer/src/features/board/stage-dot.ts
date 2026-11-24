import type { BoardStage } from '../../../../shared/board'
import type { NotionColor } from '../../../../shared/notion'

/**
 * Ponto da etapa com a cor escolhida (Colunas, quadro e lista), só com tokens do tema; sem cor,
 * neutro. Marrom não existe no tema e usa o laranja da marca.
 */
const STAGE_DOT: Record<NotionColor, string> = {
  default: 'bg-subtle-foreground',
  gray: 'bg-muted-foreground',
  brown: 'bg-brand',
  orange: 'bg-brand',
  yellow: 'bg-warn',
  green: 'bg-ok',
  blue: 'bg-info',
  purple: 'bg-purple',
  pink: 'bg-pink',
  red: 'bg-danger'
}

export function stageDotClass(stage: Pick<BoardStage, 'color'>): string {
  return STAGE_DOT[stage.color ?? 'default']
}

import { cn } from '@/lib/utils'
import type { NotionColor } from '../../../shared/notion'
import { NOTION_COLOR_TONE } from '../lib/status-text'
import { StatusDot } from './StatusToken'

/** Selo da Etapa Git (valor do Notion): ponto com a cor da opção + nome. Some sem valor. */
export function GitStageToken({
  stage,
  className
}: {
  stage: { name: string; color: NotionColor } | null
  className?: string
}): React.JSX.Element | null {
  if (!stage || !stage.name.trim()) return null
  const tone = NOTION_COLOR_TONE[stage.color] ?? 'neutral'
  return (
    <span
      title={`Etapa Git: ${stage.name}`}
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      data-testid="git-stage"
    >
      <StatusDot tone={tone} />
      <span className="sr-only">Etapa Git: </span>
      <span className="min-w-0 truncate text-muted-foreground">{stage.name}</span>
    </span>
  )
}

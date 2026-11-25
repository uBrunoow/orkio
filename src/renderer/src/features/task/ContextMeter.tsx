import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { contextTone, shortTokens, type ContextUsage } from './environment'

const RING: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger'
}

const SIZE = 16
const STROKE = 2.25
const R = (SIZE - STROKE) / 2
const LENGTH = 2 * Math.PI * R

/**
 * Quanto da janela de contexto a sessão já usou (último turno do Claude Code), ao lado do campo:
 * um anel pequeno com a porcentagem e, no hover/foco, os tokens.
 */
export function ContextMeter({
  usage,
  className,
  onClick
}: {
  usage: ContextUsage
  className?: string
  /** Abre o painel Contexto da tarefa. */
  onClick?: () => void
}): React.JSX.Element {
  const tone = contextTone(usage.percent)
  const detail = `${shortTokens(usage.inputTokens)} de ${shortTokens(usage.contextWindow)} tokens`
  const hint =
    tone === 'danger'
      ? 'Quase cheio: o Claude Code vai compactar a conversa. Uma sessão nova começa do zero.'
      : tone === 'warn'
        ? 'Passou de 70%: a conversa vai ser compactada em breve.'
        : 'Inclui o resumo da tarefa, os arquivos lidos e a conversa até aqui.'
  const meterEl = (
    <span
      role="meter"
      {...(onClick ? {} : { tabIndex: 0 })}
      aria-label="Contexto da sessão"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usage.percent}
      aria-valuetext={`${usage.percent}% (${detail})`}
      data-testid="context-meter"
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-2xs text-muted-foreground tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
        !onClick && className
      )}
    >
      <svg
        aria-hidden="true"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="-rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-muted"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={LENGTH}
          strokeDashoffset={LENGTH * (1 - usage.percent / 100)}
          className={cn('stroke-current', RING[tone])}
        />
      </svg>
      {usage.percent}%
    </span>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onClick ? (
          <button
            type="button"
            aria-label={`Contexto da sessão: ${usage.percent}%. Ver detalhes`}
            onClick={onClick}
            className={cn(
              'shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              className
            )}
          >
            {meterEl}
          </button>
        ) : (
          meterEl
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        <p className="font-medium">Contexto da sessão: {detail}</p>
        <p className="text-muted-foreground">{hint}</p>
      </TooltipContent>
    </Tooltip>
  )
}

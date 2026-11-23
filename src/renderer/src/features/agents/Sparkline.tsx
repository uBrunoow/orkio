import { cn } from '@/lib/utils'

/**
 * Mini-histograma da atividade (execuções por hora), como no mockup: barras de 3 px, até 16 px de
 * altura. A altura vai pelo `style` (valor dinâmico; CSSOM não fere a CSP).
 */
export function Sparkline({
  values,
  label
}: {
  values: readonly number[]
  label: string
}): React.JSX.Element {
  const max = Math.max(1, ...values)
  return (
    <span
      role="img"
      aria-label={label}
      data-testid="agent-activity"
      className="flex h-4 shrink-0 items-end gap-0.5"
    >
      {values.map((v, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('w-[3px] rounded-[1px]', v > 0 ? 'bg-subtle-foreground' : 'bg-border')}
          style={{ height: `${(2 + (14 * v) / max).toFixed(1)}px` }}
        />
      ))}
    </span>
  )
}

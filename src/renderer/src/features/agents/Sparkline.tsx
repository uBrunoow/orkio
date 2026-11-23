import { HStack } from '@astryxdesign/core/HStack'

/**
 * Mini-histograma da atividade (execuções por hora). Barras com altura pelo `style` (CSSOM, não
 * fere a CSP) e cor pelos tokens do tema.
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
    <HStack gap={0.5} vAlign="end" role="img" aria-label={label} data-testid="agent-activity">
      {values.map((v, i) => (
        <HStack
          key={i}
          style={{
            width: 'var(--spacing-1)',
            height: `calc(var(--spacing-1) * ${(1 + (4 * v) / max).toFixed(2)})`,
            borderRadius: 'var(--radius-inner)',
            background: v > 0 ? 'var(--color-text-secondary)' : 'var(--color-border)'
          }}
        />
      ))}
    </HStack>
  )
}

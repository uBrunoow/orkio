import { Heading } from '@astryxdesign/core/Heading'

/**
 * O h1 da tela com o tamanho de outro nível do tema (a barra e as seções usam títulos pequenos,
 * como no mockup). Tag `h1` de verdade: `aria-level` num `h3` não vale para todo leitor.
 * Só tokens do tema, pelo CSSOM (`style`), permitido pela CSP.
 */
export function ScreenTitle({
  look,
  maxLines,
  children
}: {
  /** Nível visual do tema: 3 (título de seção) ou 5 (barra da tela). */
  look: 3 | 5
  maxLines?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Heading
      level={1}
      {...(maxLines ? { maxLines } : {})}
      style={{
        fontSize: `var(--text-heading-${look}-size)`,
        lineHeight: `var(--text-heading-${look}-leading)`,
        fontWeight: `var(--text-heading-${look}-weight)`
      }}
    >
      {children}
    </Heading>
  )
}

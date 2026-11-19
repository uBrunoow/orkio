export type OrkioLogoVariant = 'full' | 'simple'

/** Abaixo deste tamanho (px) o símbolo completo perde legibilidade: usamos a versão simple. */
export const SIMPLE_VARIANT_BELOW_PX = 48
/** Wordmark com até este corpo (px) usa Jost 400 em vez de 300 (BRAND.md). */
export const WORDMARK_REGULAR_MAX_PX = 18

/** Corpo do wordmark em relação ao símbolo (altura de caixa-alta ≈ 45% do símbolo). */
const WORDMARK_RATIO = 0.64
const GAP_RATIO = 0.36

export function resolveLogoVariant(variant: OrkioLogoVariant, size: number): OrkioLogoVariant {
  return size < SIMPLE_VARIANT_BELOW_PX ? 'simple' : variant
}

export interface WordmarkMetrics {
  fontSize: number
  fontWeight: 300 | 400
  gap: number
}

export function wordmarkMetrics(size: number): WordmarkMetrics {
  const fontSize = Math.max(10, Math.round(size * WORDMARK_RATIO))
  return {
    fontSize,
    fontWeight: fontSize <= WORDMARK_REGULAR_MAX_PX ? 400 : 300,
    gap: Math.max(6, Math.round(size * GAP_RATIO))
  }
}

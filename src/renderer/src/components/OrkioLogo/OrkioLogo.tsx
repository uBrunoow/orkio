import type { CSSProperties } from 'react'
import { resolveLogoVariant, wordmarkMetrics, type OrkioLogoVariant } from './logo-metrics'
import './OrkioLogo.css'

export interface OrkioLogoProps {
  /** `full` = símbolo facetado (≥ 48px); `simple` = traço grosso. Abaixo de 48px sempre `simple`. */
  variant?: OrkioLogoVariant
  /** Mostra o wordmark "ORKIO" (Jost) ao lado do símbolo. */
  withWordmark?: boolean
  /** Altura/largura do símbolo, em px. */
  size?: number
  /** Para mudar a cor, defina `color` (símbolo) e/ou `--orkio-wordmark-color` via CSS. */
  className?: string
  /** Rótulo acessível. */
  label?: string
}

/**
 * Logo do Orkio. Desenhos de brand/orkio-symbol-currentcolor.svg (full) e
 * brand/orkio-symbol-simple.svg (simple). A cor vem do CSS (currentColor); padrão var(--accent).
 */
export function OrkioLogo({
  variant = 'full',
  withWordmark = false,
  size = 32,
  className,
  label = 'Orkio'
}: OrkioLogoProps): React.JSX.Element {
  const resolved = resolveLogoVariant(variant, size)
  const wordmark = wordmarkMetrics(size)

  // Variáveis CSS aplicadas via CSSOM (permitido pela CSP; não é atributo style inline no HTML).
  const vars = {
    '--orkio-logo-gap': `${wordmark.gap}px`,
    '--orkio-wordmark-size': `${wordmark.fontSize}px`
  } as CSSProperties

  return (
    <span
      className={['orkio-logo', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
      data-variant={resolved}
      style={vars}
    >
      <svg
        className="orkio-logo__symbol"
        width={size}
        height={size}
        viewBox="0 0 120 120"
        aria-hidden="true"
        focusable="false"
      >
        {resolved === 'full' ? <FullSymbol /> : <SimpleSymbol />}
      </svg>
      {withWordmark && (
        <span
          className={`orkio-logo__wordmark orkio-logo__wordmark--w${wordmark.fontWeight}`}
          aria-hidden="true"
        >
          ORKIO
        </span>
      )}
    </span>
  )
}

/** brand/orkio-symbol-currentcolor.svg */
function FullSymbol(): React.JSX.Element {
  return (
    <>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M30 28 L62 10 L94 26 L106 60 L82 98 L40 106 L16 72 Z" />
        <path d="M106 60 L30 28 M106 60 L62 10 M106 60 L16 72 M106 60 L40 106 M62 10 L16 72 M30 28 L40 106" />
      </g>
      <circle cx="106" cy="60" r="5.5" fill="currentColor" />
    </>
  )
}

/** brand/orkio-symbol-simple.svg */
function SimpleSymbol(): React.JSX.Element {
  return (
    <>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M30 28 L62 10 L94 26 L106 60 L82 98 L40 106 L16 72 Z" />
        <path d="M106 60 L30 28 M106 60 L16 72 M106 60 L40 106" />
      </g>
      <circle cx="106" cy="60" r="9" fill="currentColor" />
    </>
  )
}

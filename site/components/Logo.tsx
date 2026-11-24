import styles from './chrome.module.css'

/** Símbolo do Orkio (brand/orkio-symbol-currentcolor.svg). Não distorcer, girar nem sombrear. */
export function Symbol({
  size = 32,
  className,
  animated = false
}: {
  size?: number
  className?: string | undefined
  animated?: boolean
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={size < 48 ? 7 : 2.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M30 28 L62 10 L94 26 L106 60 L82 98 L40 106 L16 72 Z" />
        {/* Abaixo de 48 px, a versão simple da marca (brand/orkio-symbol-simple.svg): três raios. */}
        <path
          d={
            size >= 48
              ? 'M106 60 L30 28 M106 60 L62 10 M106 60 L16 72 M106 60 L40 106 M62 10 L16 72 M30 28 L40 106'
              : 'M106 60 L30 28 M106 60 L16 72 M106 60 L40 106'
          }
        />
      </g>
      <circle
        cx="106"
        cy="60"
        r={size < 48 ? 9 : 5.5}
        fill="currentColor"
        className={animated ? styles.hub : undefined}
      />
    </svg>
  )
}

/** Símbolo laranja + wordmark (Jost; 400 em tamanhos pequenos). */
export function Logo({ small = true }: { small?: boolean }) {
  return (
    <span className={styles.logo}>
      <Symbol size={28} className={styles.logoSymbol} />
      <span className={small ? styles.wordmarkSmall : styles.wordmark}>ORKIO</span>
    </span>
  )
}

import type { AgentColor } from '../../../../shared/agent'

/** Hash estável (FNV-1a) do id/nome: o mesmo agente tem sempre a mesma forma. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Formas no quadro 24×24 (unidades do viewBox, não px de tela). */
const SHAPES: readonly ((fill: string) => React.JSX.Element)[] = [
  (f) => <circle cx="12" cy="12" r="6" fill={f} />,
  (f) => <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill={f} />,
  (f) => <path d="M12 5.5 L18.5 17.5 H5.5 Z" fill={f} />,
  (f) => <path d="M12 5 L19 12 L12 19 L5 12 Z" fill={f} />,
  (f) => <path d="M6 15 A6 6 0 0 1 18 15 Z" fill={f} />,
  (f) => <circle cx="12" cy="12" r="5" fill="none" stroke={f} strokeWidth="2.5" />,
  (f) => (
    <>
      <rect x="6" y="6" width="5" height="5" rx="1" fill={f} />
      <rect x="13" y="13" width="5" height="5" rx="1" fill={f} />
    </>
  ),
  (f) => <path d="M6 18 L6 6 L18 18 Z" fill={f} />
]
const ROTATIONS = [0, 90, 180, 270] as const
const DOTS = [
  [5, 5],
  [19, 5],
  [19, 19],
  [5, 19]
] as const

/**
 * Avatar do agente: quadrado com uma forma geométrica derivada do id (ou do nome), nas cores do
 * tema para a cor do perfil. Sem iniciais: a forma identifica o agente; o nome vai no rótulo.
 */
export function AgentAvatar({
  name,
  color,
  seed,
  size = 'sm',
  testId
}: {
  name: string
  color: AgentColor
  /** Id estável do agente; sem ele, o nome. */
  seed?: string
  size?: 'sm' | 'md' | 'lg'
  testId?: string
}): React.JSX.Element {
  const h = hash(seed ?? name)
  const shape = SHAPES[h % SHAPES.length]!
  const rotation = ROTATIONS[(h >>> 4) % ROTATIONS.length]!
  const dot = DOTS[(h >>> 8) % DOTS.length]!
  const ink = `var(--color-icon-${color})`
  const em = size === 'lg' ? '2.5em' : size === 'md' ? '2em' : '1.5em'
  return (
    <svg
      viewBox="0 0 24 24"
      width={em}
      height={em}
      role="img"
      aria-label={`Agente: ${name}`}
      data-agent-shape={(h % SHAPES.length).toString()}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <rect width="24" height="24" rx="6" fill={`var(--color-background-${color})`} />
      <g transform={`rotate(${rotation} 12 12)`}>{shape(ink)}</g>
      <circle cx={dot[0]} cy={dot[1]} r="1.5" fill={ink} opacity="0.7" />
    </svg>
  )
}

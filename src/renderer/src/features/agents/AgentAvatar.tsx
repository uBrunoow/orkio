import type { AgentColor } from '../../../../shared/agent'

/** Hash estável (FNV-1a) do id/nome: o mesmo agente tem sempre o mesmo rosto. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Cor de fundo pelos tokens do tema (globals.css). Roxo, rosa e verde-azulado não têm token
 * próprio: saem da mistura de dois tokens de estado.
 */
const FILL: Record<AgentColor, string> = {
  orange: 'var(--brand)',
  blue: 'var(--info)',
  green: 'var(--ok)',
  yellow: 'var(--warn)',
  purple: 'var(--purple)',
  pink: 'var(--pink)',
  teal: 'color-mix(in oklch, var(--ok) 55%, var(--info))'
}

/** Cor do avatar como valor CSS (seletor de cor do editor). */
export function agentFill(color: AgentColor): string {
  return FILL[color]
}

/** Olhos no quadro 24×24 (unidades do viewBox; o mockup tem 40 px: escala 0,6). */
const FACES: readonly ((ink: string) => React.JSX.Element)[] = [
  // dois traços em pé
  (f) => (
    <>
      <rect x="7.2" y="9" width="3" height="5.4" rx="1" fill={f} />
      <rect x="13.8" y="9" width="3" height="5.4" rx="1" fill={f} />
    </>
  ),
  // dois traços deitados
  (f) => (
    <>
      <rect x="5.4" y="10.2" width="5.4" height="2.4" rx="1" fill={f} />
      <rect x="13.2" y="10.2" width="5.4" height="2.4" rx="1" fill={f} />
    </>
  ),
  // dois pontos
  (f) => (
    <>
      <circle cx="8.7" cy="11.1" r="1.6" fill={f} />
      <circle cx="15.3" cy="11.1" r="1.6" fill={f} />
    </>
  ),
  // um traço só
  (f) => <rect x="9" y="12" width="6" height="1.8" rx="0.9" fill={f} />
]

/**
 * Avatar do agente (mockup): bloco na cor do perfil com um "rosto" derivado do id (ou do nome).
 * Sem iniciais: o rosto e a forma identificam o agente; o nome vai no rótulo acessível.
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
  const face = FACES[h % FACES.length]!
  const round = ((h >>> 4) & 3) === 0
  const fill = FILL[color]
  const dim = size === 'lg' ? '2.5rem' : size === 'md' ? '2em' : '1.5em'
  return (
    <svg
      viewBox="0 0 24 24"
      width={dim}
      height={dim}
      role="img"
      aria-label={`Agente: ${name}`}
      data-agent-shape={(h % FACES.length).toString()}
      className="shrink-0"
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {round ? (
        <circle cx="12" cy="12" r="12" fill={fill} />
      ) : (
        <rect width="24" height="24" rx="6.6" fill={fill} />
      )}
      {face('var(--background)')}
    </svg>
  )
}

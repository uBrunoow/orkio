import { cn } from '@/lib/utils'

/** Cor do quadradinho do projeto (inicial), estável pelo id: a mesma na lista lateral e em Projetos. */
const PROJECT_TINTS = [
  'bg-brand text-black',
  'bg-info text-black',
  'bg-ok text-black',
  'bg-warn text-black',
  'bg-danger text-black'
]

export function projectTint(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PROJECT_TINTS[h % PROJECT_TINTS.length]!
}

const SIZE = {
  sm: 'size-[18px] rounded-[5px] text-[10px]',
  md: 'size-8 rounded-lg text-sm'
} as const

export function ProjectAvatar({
  project,
  size
}: {
  project: { id: string; name: string }
  size: keyof typeof SIZE
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center font-semibold',
        SIZE[size],
        projectTint(project.id)
      )}
    >
      {project.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

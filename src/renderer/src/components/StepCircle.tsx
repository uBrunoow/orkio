import { cn } from '@/lib/utils'

export function StepCircle({
  number,
  state
}: {
  number: number
  state: 'done' | 'current' | 'todo'
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-[22px] shrink-0 place-items-center rounded-full border font-mono text-2xs',
        state === 'done'
          ? 'border-ok-tint-border bg-ok-tint text-ok'
          : state === 'current'
            ? 'border-brand text-brand'
            : 'border-border text-subtle-foreground'
      )}
    >
      {state === 'done' ? '✓' : number}
    </span>
  )
}

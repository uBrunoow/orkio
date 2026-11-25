import { cn } from '@/lib/utils'
import type { Arrangement } from '../../app/desktops'

/**
 * Miniaturas das escolhas de Layout: retângulos com os tokens do tema (valem no claro e no
 * escuro). O painel "em foco" é o mais claro; os outros, apagados. Decorativas (o cartão diz o nome).
 */

const FRAME = 'grid h-11 w-full gap-[3px] rounded-[5px] border border-border bg-background p-[3px]'
const PANE = 'rounded-[2px] bg-muted'
const FOCUS = 'rounded-[2px] bg-subtle-foreground/70'

export function ArrangementPicture({
  arrangement
}: {
  arrangement: Arrangement
}): React.JSX.Element {
  switch (arrangement) {
    case 'single':
      return (
        <span className={cn(FRAME, 'grid-cols-1')}>
          <span className={FOCUS} />
        </span>
      )
    case 'main-stack':
      return (
        <span className={cn(FRAME, 'grid-cols-[3fr_2fr] grid-rows-2')}>
          <span className={cn(FOCUS, 'row-span-2')} />
          <span className={PANE} />
          <span className={PANE} />
        </span>
      )
    case 'columns':
      return (
        <span className={cn(FRAME, 'grid-cols-3')}>
          <span className={FOCUS} />
          <span className={PANE} />
          <span className={PANE} />
        </span>
      )
    case 'grid':
      return (
        <span className={cn(FRAME, 'grid-cols-2 grid-rows-2')}>
          <span className={FOCUS} />
          <span className={PANE} />
          <span className={PANE} />
          <span className={PANE} />
        </span>
      )
  }
}

export function GapPicture({ spaced }: { spaced: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'grid h-11 w-full grid-cols-2 rounded-[5px] border border-border',
        spaced ? 'gap-1 bg-background p-1' : 'gap-px bg-border p-0'
      )}
    >
      <span className={cn(FOCUS, !spaced && 'rounded-none rounded-l-[4px]')} />
      <span className={cn(PANE, !spaced && 'rounded-none rounded-r-[4px] bg-muted')} />
    </span>
  )
}

export function TransitionPicture({
  kind
}: {
  kind: 'slide' | 'fade' | 'instant'
}): React.JSX.Element {
  return (
    <span className="relative flex h-11 w-full items-center gap-1 rounded-[5px] border border-border bg-background p-[3px]">
      <span className={cn(PANE, 'h-full flex-1', kind === 'fade' && 'opacity-40')} />
      {kind === 'slide' && (
        <span className="absolute top-1/2 left-1/2 h-px w-3 -translate-x-1/2 bg-foreground" />
      )}
      <span className={cn(FOCUS, 'h-full flex-1', kind === 'fade' && 'opacity-60')} />
    </span>
  )
}

export function FocusPicture({ hover }: { hover: boolean }): React.JSX.Element {
  return (
    <span className="relative grid h-11 w-full grid-cols-2 gap-[3px] rounded-[5px] border border-border bg-background p-[3px]">
      <span className={PANE} />
      <span className={cn(FOCUS, 'relative')}>
        <span
          className={cn(
            'absolute right-1.5 bottom-1.5 size-2 rotate-45 border-b border-l border-foreground',
            hover && 'opacity-60'
          )}
        />
        {!hover && (
          <span className="absolute right-1 bottom-1 size-3.5 rounded-full border border-foreground/60" />
        )}
      </span>
    </span>
  )
}

export function PageWidthPicture({ full }: { full: boolean }): React.JSX.Element {
  return (
    <span className="flex h-11 w-full justify-center rounded-[5px] border border-border bg-background p-[3px]">
      <span className={cn('flex flex-col gap-[3px] rounded-[2px] p-1', full ? 'w-full' : 'w-1/2')}>
        <span className="h-1.5 w-2/3 rounded-[1px] bg-subtle-foreground/70" />
        <span className="h-1 w-full rounded-[1px] bg-muted" />
        <span className="h-1 w-full rounded-[1px] bg-muted" />
        <span className="h-1 w-4/5 rounded-[1px] bg-muted" />
      </span>
    </span>
  )
}

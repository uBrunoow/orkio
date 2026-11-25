import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ClaudeLogo } from '../components/icons'
import { headlineWindow, type ClaudeUsage, type UsageWindow } from '../../../shared/claude-usage'
import { USAGE_WINDOW_TITLE, usageResetText } from '../lib/status-text'

function Bar({ percent, wide }: { percent: number; wide?: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`relative block h-1 overflow-hidden rounded-full bg-muted ${wide ? 'w-full' : 'w-9'}`}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground"
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </span>
  )
}

function WindowRow({
  title,
  window,
  now
}: {
  title: string
  window: UsageWindow
  now: Date
}): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">{title}</span>
        <span className="font-mono text-sm text-foreground">{window.percent}%</span>
      </div>
      <Bar percent={window.percent} wide />
      <span className="text-xs text-muted-foreground">{usageResetText(window.resetsAt, now)}</span>
    </li>
  )
}

/**
 * Medidor de uso do Claude na barra (experimental): a janela mais cheia (5 h ou semana) com a
 * porcentagem; o detalhe mostra as duas e quando renovam. Sem dado, não aparece.
 */
export function UsageMeter({
  usage,
  onHide
}: {
  usage: ClaudeUsage | null
  onHide(): void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!usage) return null
  const head = headlineWindow(usage)
  if (!head) return null
  const now = new Date()
  const title = USAGE_WINDOW_TITLE[head.kind].toLowerCase()
  const label = `Uso do Claude: ${head.window.percent}% (${title}), ${usageResetText(head.window.resetsAt, now)}`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ClaudeLogo className="size-3.5" />
        <Bar percent={head.window.percent} />
        <span aria-hidden="true" className="font-mono text-2xs">
          {head.window.percent}%
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ClaudeLogo className="size-4" /> Uso do Claude
          </div>
          <ul aria-label="Janelas de uso" className="flex flex-col gap-3">
            {usage.session && (
              <WindowRow title={USAGE_WINDOW_TITLE.session} window={usage.session} now={now} />
            )}
            {usage.weekly && (
              <WindowRow title={USAGE_WINDOW_TITLE.weekly} window={usage.weekly} now={now} />
            )}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border-t border-border-soft px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Experimental: lido da sua conta do Claude Code. O Orkio não guarda o seu login.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              setOpen(false)
              onHide()
            }}
          >
            Esconder o medidor
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { Alert } from '../../components/Alert'
import { MarkdownText } from '../../components/MarkdownText'
import {
  AgentsIcon,
  EditIcon,
  InfoIcon,
  PermissionIcon,
  PlayIcon,
  ReadIcon,
  SearchIcon,
  TerminalIcon,
  ToolIcon,
  type SvgIcon
} from '../../components/icons'
import { StatusToken } from '../../components/StatusToken'
import { formatDuration, formatUsd, plural } from '../../lib/format'
import { CollapsibleHeader } from '../board/TaskDetails'
import {
  failedLabel,
  summarizeSteps,
  verbOf,
  type StepCategory,
  type TranscriptItem,
  type WorkStep
} from './run-transcript'

const CATEGORY_ICON: Record<StepCategory, SvgIcon> = {
  command: TerminalIcon,
  edit: EditIcon,
  read: ReadIcon,
  search: SearchIcon,
  subagent: AgentsIcon,
  tool: ToolIcon
}

/** Mais recentes primeiro quando o log é longo; o resto abre em "Mostrar anteriores". */
const TAIL = 40

/** Caixa das chamadas de ferramenta (mockup `.tools`): borda suave, fundo da superfície, mono. */
const TOOLS_BOX =
  'rounded-lg border border-border-soft bg-surface px-2.5 py-2 font-mono text-xs text-muted-foreground'

function StepRow({ step }: { step: WorkStep }): React.JSX.Element {
  const failed = step.state === 'failed'
  const verb = verbOf(step.tool)
  const StepIcon = CATEGORY_ICON[step.category]
  return (
    <div className="flex min-w-0 items-start gap-2">
      <StepIcon
        className={cn('mt-0.5 size-3.5', failed ? 'text-danger' : 'text-subtle-foreground')}
      />
      <p className={cn('min-w-0 flex-1 break-words', failed && 'text-foreground')}>
        <span className="font-sans">{verb}</span>
        {step.summary && <> {step.summary}</>}
      </p>
      {failed && <StatusToken tone="danger" label="falhou" className="font-sans" />}
      {step.state === 'running' && (
        <StatusToken tone="running" label="rodando" className="font-sans" />
      )}
    </div>
  )
}

function dominantCategory(steps: readonly WorkStep[]): StepCategory {
  const counts = new Map<StepCategory, number>()
  for (const s of steps) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  let best: StepCategory = 'tool'
  let max = 0
  for (const [category, n] of counts) {
    if (n > max) {
      best = category
      max = n
    }
  }
  return best
}

function WorkGroup({
  item,
  open,
  onToggle
}: {
  item: Extract<TranscriptItem, { kind: 'work' }>
  open: boolean
  onToggle(open: boolean): void
}): React.JSX.Element {
  const only = item.steps.length === 1 ? item.steps[0] : undefined
  if (only) {
    return (
      <div className={TOOLS_BOX}>
        <StepRow step={only} />
      </div>
    )
  }
  const summary = summarizeSteps(item.steps)
  const GroupIcon = CATEGORY_ICON[dominantCategory(item.steps)]
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      data-testid="work-group"
      className={cn(TOOLS_BOX, 'flex flex-col')}
    >
      <CollapsibleHeader open={open} className="flex-wrap font-sans text-xs text-muted-foreground">
        <GroupIcon className="size-3.5 text-subtle-foreground" />
        <span className="text-foreground">{summary.label}</span>
        {item.approvals > 0 && <span>· {plural(item.approvals, 'aprovação', 'aprovações')}</span>}
        {summary.failed > 0 && <StatusToken tone="danger" label={failedLabel(summary.failed)} />}
        {item.live && <StatusToken tone="running" label="rodando" />}
      </CollapsibleHeader>
      <CollapsibleContent>
        <div
          role="group"
          aria-label="Chamadas de ferramenta"
          className="mt-1.5 flex flex-col gap-1"
        >
          {item.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Receipt({
  tone,
  text,
  count
}: {
  tone: 'info' | 'problem'
  text: string
  count: number
}): React.JSX.Element {
  const problem = tone === 'problem'
  const ReceiptIcon = problem ? PermissionIcon : InfoIcon
  return (
    <div className="flex items-start gap-2 text-xs">
      <ReceiptIcon
        className={cn('mt-0.5 size-3.5', problem ? 'text-danger' : 'text-subtle-foreground')}
      />
      <p
        className={cn(
          'min-w-0 flex-1',
          problem ? 'font-medium text-foreground' : 'text-muted-foreground'
        )}
      >
        {text}
        {count > 1 ? ` (×${count})` : ''}
      </p>
    </div>
  )
}

function ResultFooter({
  item
}: {
  item: Extract<TranscriptItem, { kind: 'result' }>
}): React.JSX.Element {
  const meta = [
    item.turns !== null ? plural(item.turns, 'turno', 'turnos') : '',
    item.durationMs !== null ? formatDuration(item.durationMs) : '',
    item.costUsd !== null ? `${formatUsd(item.costUsd)} (estimado)` : ''
  ].filter(Boolean)
  return (
    <div data-testid="run-result" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusToken
          tone={item.ok ? 'success' : 'danger'}
          label={item.ok ? 'Terminou' : 'Terminou com erro'}
        />
        {meta.length > 0 && (
          <span className="tabular font-mono text-2xs text-subtle-foreground">
            {meta.join(' · ')}
          </span>
        )}
      </div>
      {item.text && <MarkdownText text={item.text} />}
    </div>
  )
}

/**
 * Sessão do Claude Code como conversa: respostas em markdown, ferramentas agrupadas numa frase,
 * recibos de permissão, avisos de falha e o fechamento com turnos, tempo e custo.
 */
export function RunTranscript({
  items,
  tail = TAIL
}: {
  items: readonly TranscriptItem[]
  tail?: number
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const hidden = showAll ? 0 : Math.max(0, items.length - tail)
  const shown = hidden > 0 ? items.slice(-tail) : items

  return (
    <div className="flex flex-col gap-3">
      {items.length > tail && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Mostrar só o fim' : `Mostrar ${hidden} anteriores`}
          </Button>
        </div>
      )}
      <ul aria-label="Log da execução" aria-live="polite" className="flex flex-col gap-3">
        {shown.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col">
            {item.kind === 'started' && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <PlayIcon className="size-3.5 text-subtle-foreground" />
                Sessão iniciada{item.model ? ` (${item.model})` : ''}
              </p>
            )}
            {item.kind === 'message' && <MarkdownText text={item.text} />}
            {item.kind === 'work' && (
              <WorkGroup
                item={item}
                open={open[item.key] ?? item.live}
                onToggle={(next) => setOpen((o) => ({ ...o, [item.key]: next }))}
              />
            )}
            {item.kind === 'receipt' && (
              <Receipt tone={item.tone} text={item.text} count={item.count} />
            )}
            {item.kind === 'notice' &&
              (item.tone === 'danger' ? (
                <Alert tone="danger">{item.text}</Alert>
              ) : (
                <StatusToken tone="neutral" label={item.text} />
              ))}
            {item.kind === 'result' && <ResultFooter item={item} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

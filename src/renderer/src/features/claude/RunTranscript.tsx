import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Code } from '@astryxdesign/core/Code'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
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

function StepRow({ step }: { step: WorkStep }): React.JSX.Element {
  const failed = step.state === 'failed'
  const verb = verbOf(step.tool)
  return (
    <HStack gap={2} vAlign="start">
      <Icon icon={CATEGORY_ICON[step.category]} size="sm" color={failed ? 'error' : 'secondary'} />
      <StackItem size="fill">
        <Text type="supporting" color={failed ? 'primary' : 'secondary'}>
          {verb}
          {step.summary && (
            <>
              {' '}
              <Code size="inherit">{step.summary}</Code>
            </>
          )}
        </Text>
      </StackItem>
      {failed && <StatusToken tone="danger" label="falhou" />}
      {step.state === 'running' && <StatusToken tone="running" label="rodando" />}
    </HStack>
  )
}

function dominantIcon(steps: readonly WorkStep[]): SvgIcon {
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
  return CATEGORY_ICON[best]
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
  if (only) return <StepRow step={only} />
  const summary = summarizeSteps(item.steps)
  return (
    <Collapsible
      chevronPosition="start"
      isOpen={open}
      onOpenChange={onToggle}
      data-testid="work-group"
      trigger={
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Icon icon={dominantIcon(item.steps)} size="sm" color="secondary" />
          <Text type="supporting" color="primary">
            {summary.label}
          </Text>
          {item.approvals > 0 && (
            <Text type="supporting">· {plural(item.approvals, 'aprovação', 'aprovações')}</Text>
          )}
          {summary.failed > 0 && <StatusToken tone="danger" label={failedLabel(summary.failed)} />}
          {item.live && <StatusToken tone="running" label="rodando" />}
        </HStack>
      }
    >
      <VStack gap={1} role="group" aria-label="Chamadas de ferramenta">
        {item.steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </VStack>
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
  return (
    <HStack gap={2} vAlign="start">
      <Icon
        icon={problem ? PermissionIcon : InfoIcon}
        size="sm"
        color={problem ? 'error' : 'secondary'}
      />
      <StackItem size="fill">
        <Text
          type="supporting"
          color={problem ? 'primary' : 'secondary'}
          {...(problem ? { weight: 'medium' as const } : {})}
        >
          {text}
          {count > 1 ? ` (×${count})` : ''}
        </Text>
      </StackItem>
    </HStack>
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
    <VStack gap={2} data-testid="run-result">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StatusToken
          tone={item.ok ? 'success' : 'danger'}
          label={item.ok ? 'Terminou' : 'Terminou com erro'}
        />
        {meta.length > 0 && <Text type="supporting">{meta.join(' · ')}</Text>}
      </HStack>
      {item.text && <MarkdownText text={item.text} />}
    </VStack>
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
    <VStack gap={3}>
      {items.length > tail && (
        <HStack>
          <Button
            size="sm"
            variant="ghost"
            label={showAll ? 'Mostrar só o fim' : `Mostrar ${hidden} anteriores`}
            onClick={() => setShowAll((v) => !v)}
          />
        </HStack>
      )}
      <VStack gap={3} role="list" aria-label="Log da execução" aria-live="polite">
        {shown.map((item) => (
          <VStack key={item.key} role="listitem">
            {item.kind === 'started' && (
              <HStack gap={2} vAlign="center">
                <Icon icon={PlayIcon} size="sm" color="secondary" />
                <Text type="supporting">Sessão iniciada{item.model ? ` (${item.model})` : ''}</Text>
              </HStack>
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
          </VStack>
        ))}
      </VStack>
    </VStack>
  )
}

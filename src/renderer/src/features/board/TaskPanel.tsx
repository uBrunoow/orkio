import { useEffect, useState } from 'react'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { List } from '@astryxdesign/core/List'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type {
  BoardCard,
  BoardHistoryEntry,
  BoardStage,
  TaskSignals
} from '../../../../shared/ipc-contract'
import { EVENT_LABELS, type EventKind } from '../../../../shared/automation'
import { CloseIcon, ExternalLinkIcon } from '../../components/icons'
import { TaskSignalsLine } from '../notion-workspace/TaskSignalsLine'
import { tokenColor } from '../notion-workspace/notion-colors'

/** Painel lateral da tarefa: dados, ações, branch/PR e histórico (task_events). */
export function TaskPanel({
  projectId,
  card,
  stages,
  signals,
  onMove,
  onToggleBlocked,
  onToggleAutomation,
  onClose
}: {
  projectId: string
  card: BoardCard
  stages: readonly BoardStage[]
  signals: TaskSignals | undefined
  onMove(stageId: string): void
  onToggleBlocked(blocked: boolean): void
  onToggleAutomation(paused: boolean): void
  onClose(): void
}): React.JSX.Element {
  const [history, setHistory] = useState<BoardHistoryEntry[] | null>(null)
  const stageName = (id: string | null): string =>
    id ? (stages.find((s) => s.id === id)?.name ?? 'etapa removida') : 'Sem etapa'

  // Recarrega o histórico quando o card muda (movido, sincronizado, recusado).
  useEffect(() => {
    let active = true
    void window.orkio.board
      .history(projectId, card.taskId)
      .then((result) => {
        if (active) setHistory(result.ok ? result.value : [])
      })
      .catch(() => {
        if (active) setHistory([])
      })
    return () => {
      active = false
    }
  }, [projectId, card.taskId, card.stageId, card.blocked, card.automationPaused, card.sync.state])

  return (
    <Card role="complementary" aria-label={`Detalhes de ${card.displayId ?? card.title}`}>
      <VStack gap={4}>
        <HStack gap={2} vAlign="start">
          <StackItem size="fill">
            <VStack gap={1}>
              <Code>{card.displayId ?? '—'}</Code>
              <Heading level={2}>{card.title}</Heading>
            </VStack>
          </StackItem>
          <IconButton
            size="sm"
            variant="ghost"
            label="Fechar"
            icon={<Icon icon={CloseIcon} />}
            onClick={onClose}
          />
        </HStack>

        <HStack gap={2} wrap="wrap" vAlign="center">
          {card.status && (
            <Token
              size="sm"
              label={`Notion: ${card.status.name}`}
              color={tokenColor(card.status.color)}
            />
          )}
          {card.priority && (
            <Token size="sm" label={card.priority.name} color={tokenColor(card.priority.color)} />
          )}
          {card.sync.state === 'pending' && (
            <Token size="sm" color="yellow" label="Sincronizando" />
          )}
        </HStack>
        {card.sync.state === 'pending' && card.sync.message && (
          <Text type="supporting">{card.sync.message}</Text>
        )}
        {card.assignees.length > 0 && (
          <Text type="supporting">Responsável: {card.assignees.join(', ')}</Text>
        )}
        <TaskSignalsLine signals={signals} />

        <Selector
          label="Mover para"
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
          {...(card.stageId ? { value: card.stageId } : { placeholder: 'Sem etapa' })}
          onChange={(value: string) => {
            if (value !== card.stageId) onMove(value)
          }}
        />
        <CheckboxInput
          label="Bloqueada"
          value={card.blocked}
          onChange={(checked) => onToggleBlocked(checked)}
        />
        <CheckboxInput
          label="Pausar automações desta tarefa"
          value={card.automationPaused}
          onChange={(checked) => onToggleAutomation(checked)}
        />
        {card.url && (
          <HStack gap={2} vAlign="center">
            <IconButton
              variant="ghost"
              size="sm"
              label="Abrir no Notion"
              icon={<Icon icon={ExternalLinkIcon} />}
              onClick={() => void window.orkio.openExternal(card.url!)}
            />
            <Text type="supporting">Abrir no Notion</Text>
          </HStack>
        )}

        <VStack gap={2}>
          <Heading level={3}>Histórico</Heading>
          {history === null ? (
            <Skeleton height={40} aria-label="Carregando histórico" />
          ) : history.length === 0 ? (
            <Text type="supporting">Sem eventos ainda.</Text>
          ) : (
            <List hasDividers density="compact" aria-label="Histórico da tarefa">
              {history.map((e) => (
                <Item
                  as="li"
                  key={e.id}
                  label={describe(e, stageName)}
                  description={new Date(e.at).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short'
                  })}
                  {...(prUrl(e)
                    ? {
                        endContent: (
                          <IconButton
                            size="sm"
                            variant="ghost"
                            label={`Abrir a PR #${prNumber(e)} no GitHub`}
                            icon={<Icon icon={ExternalLinkIcon} />}
                            onClick={() => void window.orkio.openExternal(prUrl(e)!)}
                          />
                        )
                      }
                    : {})}
                />
              ))}
            </List>
          )}
        </VStack>
      </VStack>
    </Card>
  )
}

function prNumber(e: BoardHistoryEntry): number | null {
  const pr = e.detail?.['pr'] as { number?: unknown } | undefined
  return typeof pr?.number === 'number' ? pr.number : null
}

/** Link da PR montado a partir de owner/repo/número (o banco não guarda URLs nem títulos). */
function prUrl(e: BoardHistoryEntry): string | null {
  const pr = e.detail?.['pr'] as { number?: unknown; owner?: unknown; repo?: unknown } | undefined
  return typeof pr?.number === 'number' &&
    typeof pr.owner === 'string' &&
    typeof pr.repo === 'string'
    ? `https://github.com/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pull/${pr.number}`
    : null
}

/** "PR #45 mergeada" / "Branch criada (ORK-1/x)". */
function automationEvent(e: BoardHistoryEntry): string {
  const kind = e.detail?.['event']
  const label =
    typeof kind === 'string' && kind in EVENT_LABELS ? EVENT_LABELS[kind as EventKind] : 'Evento'
  const n = prNumber(e)
  const branch = e.detail?.['branch'] as { name?: unknown } | undefined
  return n !== null
    ? `${label} (PR #${n})`
    : typeof branch?.name === 'string'
      ? `${label} (${branch.name})`
      : label
}

function describe(e: BoardHistoryEntry, stageName: (id: string | null) => string): string {
  const rule = typeof e.detail?.['ruleName'] === 'string' ? `“${e.detail['ruleName']}”` : null
  if (e.kind === 'moved' && e.source === 'automation') {
    return `${automationEvent(e)} → regra ${rule ?? ''}: ${stageName(e.fromStage)} → ${stageName(e.toStage)}`
  }
  if (e.kind === 'automation') {
    const outcome = e.detail?.['outcome']
    if (outcome === 'skipped') {
      return `${automationEvent(e)}: regra ${rule ?? ''} ignorada (${String(e.detail?.['reason'] ?? '')})`
    }
    if (outcome === 'noop') return `${automationEvent(e)}: já estava em ${stageName(e.fromStage)}`
    if (outcome === 'notify') return `${automationEvent(e)}: notificação (regra ${rule ?? ''})`
    return automationEvent(e)
  }
  switch (e.kind) {
    case 'automation_paused':
      return 'Automações pausadas nesta tarefa'
    case 'automation_resumed':
      return 'Automações retomadas nesta tarefa'
    case 'added':
      return `Entrou no quadro em ${stageName(e.toStage)}`
    case 'moved':
      return `Movida de ${stageName(e.fromStage)} para ${stageName(e.toStage)}`
    case 'reconciled': {
      const status =
        typeof e.detail?.['status'] === 'string' ? ` (status “${e.detail['status']}”)` : ''
      return `Reposicionada pelo Notion: ${stageName(e.fromStage)} → ${stageName(e.toStage)}${status}`
    }
    case 'blocked':
      return e.source === 'notion' ? 'Marcada como bloqueada no Notion' : 'Marcada como bloqueada'
    case 'unblocked':
      return e.source === 'notion' ? 'Desbloqueada no Notion' : 'Desbloqueada'
    case 'sync_ok':
      return 'Sincronizada com o Notion'
    case 'rolled_back':
      return `O Notion recusou a mudança; voltou para ${stageName(e.toStage)}`
    default:
      return e.kind
  }
}
